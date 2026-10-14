// Package affiliate builds "complete the look" product cards that link to partner stores,
// through signed, logged redirects so commissions can be reconciled.
package affiliate

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Need is a gap in an outfit: what's missing and the colour that would complete it.
type Need struct {
	Category    string `json:"category"`
	Subcategory string `json:"subcategory,omitempty"`
	Colour      string `json:"colour"` // a colour name, e.g. "navy"
	Hex         string `json:"hex"`
}

// Product is one tappable card.
type Product struct {
	NeedIndex   int    `json:"need_index"`
	Partner     string `json:"partner"`
	PartnerName string `json:"partner_name"`
	Title       string `json:"title"`
	ImageURL    string `json:"image_url,omitempty"`
	PriceINR    int    `json:"price_inr,omitempty"`
	ColorHex    string `json:"color_hex"`
	// A signed /go/ link; the redirect logs the click and sends the user to the store.
	URL string `json:"url"`
}

// FeedProduct is a row from a partner's product feed.
type FeedProduct struct {
	Partner, Title, Category, ColorHex, ImageURL, URL string
	PriceINR                                          int
}

// Feed returns active feed products in a category; empty when no feed is loaded.
type Feed interface {
	ByCategory(ctx context.Context, category string, limit int) ([]FeedProduct, error)
}

// Partner is a store the app can link to.
type Partner struct {
	Key, Name string
	search    func(query string) string
}

// Config holds the operator's affiliate identifiers; everything is optional.
type Config struct {
	Secret []byte
	// Amazon Associates tracking id, e.g. "virtualwardrobe-21".
	AmazonTag string
	// A deep-link wrapper from an affiliate network (Cuelinks, EarnKaro, Admitad, ...) with a
	// {url} placeholder, applied to every non-Amazon partner, e.g.
	// "https://linksredirect.com/?cid=123&source=linkkit&url={url}".
	Wrapper string
	// Partner keys to offer, in order; default myntra, ajio, amazon, zara.
	Partners []string
}

// Service builds product cards.
type Service struct {
	cfg      Config
	feed     Feed
	partners []Partner
	now      func() time.Time
}

func New(cfg Config, feed Feed) *Service {
	all := map[string]Partner{
		"myntra": {Key: "myntra", Name: "Myntra", search: func(q string) string {
			return "https://www.myntra.com/" + url.PathEscape(strings.ReplaceAll(q, " ", "-"))
		}},
		"ajio": {Key: "ajio", Name: "AJIO", search: func(q string) string {
			return "https://www.ajio.com/search/?text=" + url.QueryEscape(q)
		}},
		"amazon": {Key: "amazon", Name: "Amazon.in", search: func(q string) string {
			u := "https://www.amazon.in/s?k=" + url.QueryEscape(q)
			if cfg.AmazonTag != "" {
				u += "&tag=" + url.QueryEscape(cfg.AmazonTag)
			}
			return u
		}},
		"zara": {Key: "zara", Name: "Zara", search: func(q string) string {
			return "https://www.zara.com/in/en/search?searchTerm=" + url.QueryEscape(q)
		}},
	}
	keys := cfg.Partners
	if len(keys) == 0 {
		keys = []string{"myntra", "ajio", "amazon", "zara"}
	}
	s := &Service{cfg: cfg, feed: feed, now: time.Now}
	for _, k := range keys {
		if p, ok := all[strings.TrimSpace(k)]; ok {
			s.partners = append(s.partners, p)
		}
	}
	return s
}

// Disclosure is shown with every card (ASCI guidelines on influencer and affiliate advertising).
const Disclosure = "Sponsored links: we may earn a commission if you buy, at no extra cost to you."

var nouns = map[string]string{
	"shirts": "shirt", "t-shirts": "t-shirt", "knitwear": "sweater", "trousers": "trousers", "jeans": "jeans",
	"skirts": "skirt", "jackets": "jacket", "coats": "coat", "sneakers": "sneakers", "formal-shoes": "formal shoes",
	"kurtas": "kurta", "sarees": "saree", "lehengas": "lehenga", "salwar-sets": "salwar suit", "sherwanis": "sherwani",
	"mundu-dhoti": "mundu", "tops": "top", "bottoms": "trousers", "outerwear": "jacket", "footwear": "shoes",
	"ethnic": "ethnic wear", "accessories": "accessories",
}

// Query is the store search text for a need, e.g. "navy chinos".
func Query(n Need) string {
	noun := nouns[n.Subcategory]
	if noun == "" {
		noun = nouns[n.Category]
	}
	if noun == "" {
		noun = "clothing"
	}
	return strings.TrimSpace(strings.ToLower(n.Colour) + " " + noun)
}

const maxNeeds = 4

// Recommend returns feed products closest in colour first, then a search card per partner.
// baseURL is where /go/ links are served.
func (s *Service) Recommend(ctx context.Context, needs []Need, baseURL string) ([]Product, error) {
	if len(needs) > maxNeeds {
		needs = needs[:maxNeeds]
	}
	var out []Product
	for i, n := range needs {
		if _, ok := nouns[n.Category]; !ok {
			return nil, errors.New("unknown category " + strconv.Quote(n.Category))
		}
		q := Query(n)
		if s.feed != nil {
			items, err := s.feed.ByCategory(ctx, n.Category, 200)
			if err != nil {
				return nil, err
			}
			sort.SliceStable(items, func(a, b int) bool { return deltaE(items[a].ColorHex, n.Hex) < deltaE(items[b].ColorHex, n.Hex) })
			for _, p := range items {
				if len(out) >= (i+1)*6 || deltaE(p.ColorHex, n.Hex) > 25 {
					break
				}
				out = append(out, Product{NeedIndex: i, Partner: p.Partner, PartnerName: p.Partner, Title: p.Title, ImageURL: p.ImageURL,
					PriceINR: p.PriceINR, ColorHex: p.ColorHex, URL: s.goLink(baseURL, p.Partner, n.Category, s.wrap(p.Partner, p.URL))})
			}
		}
		for _, p := range s.partners {
			target := s.wrap(p.Key, p.search(q))
			out = append(out, Product{NeedIndex: i, Partner: p.Key, PartnerName: p.Name, Title: titleCase(q), ColorHex: strings.ToUpper(n.Hex),
				URL: s.goLink(baseURL, p.Key, n.Category, target)})
		}
	}
	return out, nil
}

func (s *Service) wrap(partner, target string) string {
	if partner == "amazon" || !strings.Contains(s.cfg.Wrapper, "{url}") {
		return target
	}
	return strings.ReplaceAll(s.cfg.Wrapper, "{url}", url.QueryEscape(target))
}

type token struct {
	Partner  string `json:"p"`
	Category string `json:"c"`
	URL      string `json:"u"`
	Expires  int64  `json:"e"`
}

const linkTTL = 30 * 24 * time.Hour

func (s *Service) goLink(baseURL, partner, category, target string) string {
	payload, _ := json.Marshal(token{Partner: partner, Category: category, URL: target, Expires: s.now().Add(linkTTL).Unix()})
	body := base64.RawURLEncoding.EncodeToString(payload)
	return strings.TrimRight(baseURL, "/") + "/go/" + body + "." + s.sign(body)
}

func (s *Service) sign(body string) string {
	m := hmac.New(sha256.New, s.cfg.Secret)
	m.Write([]byte(body))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// ErrBadLink means a /go/ token was forged, mangled or expired.
var ErrBadLink = errors.New("invalid or expired link")

// Resolve verifies a /go/ token and returns where to send the user.
func (s *Service) Resolve(tok string) (partner, category, target string, err error) {
	body, sig, ok := strings.Cut(tok, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(s.sign(body))) {
		return "", "", "", ErrBadLink
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return "", "", "", ErrBadLink
	}
	var t token
	if json.Unmarshal(raw, &t) != nil || s.now().Unix() > t.Expires || !strings.HasPrefix(t.URL, "https://") {
		return "", "", "", ErrBadLink
	}
	return t.Partner, t.Category, t.URL, nil
}

func titleCase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}

// deltaE is CIE76 between two #RRGGBB colours (999 if either is malformed).
func deltaE(a, b string) float64 {
	la, ok1 := lab(a)
	lb, ok2 := lab(b)
	if !ok1 || !ok2 {
		return 999
	}
	return math.Sqrt((la[0]-lb[0])*(la[0]-lb[0]) + (la[1]-lb[1])*(la[1]-lb[1]) + (la[2]-lb[2])*(la[2]-lb[2]))
}

func lab(hex string) ([3]float64, bool) {
	hex = strings.TrimPrefix(hex, "#")
	n, err := strconv.ParseUint(hex, 16, 32)
	if len(hex) != 6 || err != nil {
		return [3]float64{}, false
	}
	lin := func(c uint64) float64 {
		v := float64(c) / 255
		if v <= 0.04045 {
			return v / 12.92
		}
		return math.Pow((v+0.055)/1.055, 2.4)
	}
	r, g, b := lin(n>>16&255), lin(n>>8&255), lin(n&255)
	x := (0.4124564*r + 0.3575761*g + 0.1804375*b) / 0.95047
	y := 0.2126729*r + 0.7151522*g + 0.072175*b
	z := (0.0193339*r + 0.119192*g + 0.9503041*b) / 1.08883
	f := func(t float64) float64 {
		if t > 216.0/24389 {
			return math.Cbrt(t)
		}
		return (24389.0/27*t + 16) / 116
	}
	fx, fy, fz := f(x), f(y), f(z)
	return [3]float64{116*fy - 16, 500 * (fx - fy), 200 * (fy - fz)}, true
}
