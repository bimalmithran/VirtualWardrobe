package httpapi

import (
	"context"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/affiliate"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/billing"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

type EntitlementReader interface {
	Entitlements(ctx context.Context, user domain.UserID) (domain.Entitlements, error)
}

type WebhookHandler interface {
	Handle(ctx context.Context, authorization string, body []byte) error
}

type AffiliateService interface {
	Recommend(ctx context.Context, needs []affiliate.Need, baseURL string) ([]affiliate.Product, error)
	Resolve(token string) (partner, category, target string, err error)
}

type ClickLogger interface {
	LogClick(ctx context.Context, partner, category string) error
}

type ResaleService interface {
	Create(ctx context.Context, in wardrobe.CreateListingInput) (domain.Listing, error)
	Get(ctx context.Context, viewer, id string) (domain.Listing, error)
	Feed(ctx context.Context, viewer, category string, limit int) ([]domain.Listing, error)
	Mine(ctx context.Context, user string) ([]domain.Listing, error)
	Update(ctx context.Context, user, id string, status *domain.ListingStatus, price *int) error
	Inquire(ctx context.Context, buyer, id, message, contact string) error
	Inquiries(ctx context.Context, seller, id string) ([]domain.Inquiry, error)
}

type commerceHandler struct {
	entitlements EntitlementReader
	webhook      WebhookHandler
	affiliate    AffiliateService
	clicks       ClickLogger
	resale       ResaleService
	urls         urlResolver
	errs         errorWriter
	log          *slog.Logger
}

// entitlements: GET /api/me/entitlements
func (h *commerceHandler) getEntitlements(w http.ResponseWriter, r *http.Request) {
	user, err := actingUser(r, r.URL.Query().Get("user_id"))
	var e domain.Entitlements
	if err == nil {
		e, err = h.entitlements.Entitlements(r.Context(), domain.NormalizeUserID(user))
	}
	if err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

// revenueCat: POST /api/webhooks/revenuecat, authenticated by the shared secret RevenueCat sends.
func (h *commerceHandler) revenueCat(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "body too large")
		return
	}
	switch err := h.webhook.Handle(r.Context(), r.Header.Get("Authorization"), body); {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case err == billing.ErrBadSignature:
		writeError(w, http.StatusUnauthorized, err.Error())
	default:
		h.errs.write(w, err)
	}
}

type recommendRequest struct {
	Needs []affiliate.Need `json:"needs"`
}

// recommend: POST /api/affiliate/recommendations -> partner product cards with signed links.
func (h *commerceHandler) recommend(w http.ResponseWriter, r *http.Request) {
	var req recommendRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	products, err := h.affiliate.Recommend(r.Context(), req.Needs, h.urls.absolute(r, "/"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if products == nil {
		products = []affiliate.Product{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"disclosure": affiliate.Disclosure, "products": products})
}

// goRedirect: GET /go/{token} (public; opened in the browser). Logs the click, then 302s.
func (h *commerceHandler) goRedirect(w http.ResponseWriter, r *http.Request) {
	partner, category, target, err := h.affiliate.Resolve(r.PathValue("token"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if err := h.clicks.LogClick(r.Context(), partner, category); err != nil {
		h.log.Warn("affiliate click not logged", "err", err) // never block the shopper on logging
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, target, http.StatusFound)
}

type listingRequest struct {
	UserID       string `json:"user_id"`
	ClientItemID string `json:"client_item_id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	PriceINR     int    `json:"price_inr"`
	Condition    string `json:"condition"`
	Size         string `json:"size"`
	Category     string `json:"category"`
	ColorHex     string `json:"color_hex"`
	City         string `json:"city"`
	ImageBase64  string `json:"image_base64"`
}

func (h *commerceHandler) createListing(w http.ResponseWriter, r *http.Request) {
	var req listingRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	user, err := actingUser(r, req.UserID)
	var l domain.Listing
	if err == nil {
		l, err = h.resale.Create(r.Context(), wardrobe.CreateListingInput{
			NewListing: domain.NewListing{
				UserID: domain.UserID(user), ClientItemID: domain.ClientItemID(req.ClientItemID), Title: req.Title,
				Description: req.Description, PriceINR: req.PriceINR, Condition: domain.ListingCondition(req.Condition),
				Size: req.Size, Category: req.Category, ColorHex: domain.ColorHex(req.ColorHex), City: req.City,
			},
			ImageBase64: req.ImageBase64,
		})
	}
	if err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, h.resolveListing(r, l))
}

func (h *commerceHandler) feed(w http.ResponseWriter, r *http.Request) {
	user, err := actingUser(r, r.URL.Query().Get("user_id"))
	var ls []domain.Listing
	if err == nil {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if r.URL.Query().Get("mine") == "1" {
			ls, err = h.resale.Mine(r.Context(), user)
		} else {
			ls, err = h.resale.Feed(r.Context(), user, r.URL.Query().Get("category"), limit)
		}
	}
	if err != nil {
		h.errs.write(w, err)
		return
	}
	out := make([]domain.Listing, len(ls))
	for i, l := range ls {
		out[i] = h.resolveListing(r, l)
	}
	writeJSON(w, http.StatusOK, map[string]any{"listings": out})
}

type listingPatch struct {
	Status   *domain.ListingStatus `json:"status"`
	PriceINR *int                  `json:"price_inr"`
}

func (h *commerceHandler) updateListing(w http.ResponseWriter, r *http.Request) {
	var req listingPatch
	if !decodeJSON(w, r, &req) {
		return
	}
	user, err := actingUser(r, "")
	if err == nil {
		err = h.resale.Update(r.Context(), user, r.PathValue("id"), req.Status, req.PriceINR)
	}
	if err != nil {
		h.errs.write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type inquiryRequest struct {
	Message string `json:"message"`
	Contact string `json:"contact"`
}

func (h *commerceHandler) inquire(w http.ResponseWriter, r *http.Request) {
	var req inquiryRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	user, err := actingUser(r, "")
	if err == nil {
		err = h.resale.Inquire(r.Context(), user, r.PathValue("id"), req.Message, req.Contact)
	}
	if err != nil {
		h.errs.write(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *commerceHandler) inquiries(w http.ResponseWriter, r *http.Request) {
	user, err := actingUser(r, "")
	var out []domain.Inquiry
	if err == nil {
		out, err = h.resale.Inquiries(r.Context(), user, r.PathValue("id"))
	}
	if err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"inquiries": out})
}

func (h *commerceHandler) resolveListing(r *http.Request, l domain.Listing) domain.Listing {
	l.ImageURL = h.urls.absolute(r, l.ImageURL)
	return l
}

var listingPage = template.Must(template.New("l").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Title}} · ₹{{.PriceINR}}</title>
<meta property="og:title" content="{{.Title}} · ₹{{.PriceINR}}"><meta property="og:image" content="{{.ImageURL}}">
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px;background:#F7F5F2;color:#1C1B1A}
img{width:100%;background:#ECE8E2;border-radius:16px}h1{font-size:22px;margin:12px 0 4px}.price{font-size:20px;font-weight:700;color:#3A5A40}
.muted{color:#6E6A65}.sold{color:#B91C1C;font-weight:700}</style></head>
<body><img src="{{.ImageURL}}" alt="{{.Title}}"><h1>{{.Title}}</h1>
<div class="price">₹{{.PriceINR}}</div>
{{if ne .Status "active"}}<p class="sold">This item is no longer available.</p>{{end}}
<p class="muted">{{.Condition}}{{if .Size}} · size {{.Size}}{{end}}{{if .City}} · {{.City}}{{end}}</p>
<p>{{.Description}}</p>
<p class="muted">Open VirtualWardrobe and use “I'm interested” to message the seller.</p></body></html>`))

// publicListing: GET /l/{id} (public share page; html/template escapes all seller text).
func (h *commerceHandler) publicListing(w http.ResponseWriter, r *http.Request) {
	l, err := h.resale.Get(r.Context(), "", r.PathValue("id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	l = h.resolveListing(r, l)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src *; style-src 'unsafe-inline'")
	listingPage.Execute(w, l) //nolint:errcheck // client went away
}
