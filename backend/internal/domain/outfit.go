package domain

import "time"

// MaxOutfitItems bounds one outfit (top, bottom, layer, shoes, a few accessories).
const MaxOutfitItems = 12

// ClientOutfitID is the phone's id for an outfit; same alphabet as ClientItemID.
type ClientOutfitID string

func (id ClientOutfitID) Valid() bool { return clientIDRe.MatchString(string(id)) }

// NewOutfit is an outfit as the phone describes it: garments referenced by their
// client ids, in display order.
type NewOutfit struct {
	UserID         UserID
	ClientOutfitID ClientOutfitID
	Name           string
	Occasion       string
	ItemIDs        []ClientItemID
	Metadata       Metadata
}

func (o NewOutfit) Validate() error {
	switch {
	case !o.UserID.Valid():
		return invalid("user_id", "must be a UUID")
	case !o.ClientOutfitID.Valid():
		return invalid("client_outfit_id", "must be 1-64 characters of [A-Za-z0-9_-]")
	case len(o.Name) == 0 || len(o.Name) > 80:
		return invalid("name", "must be 1-80 characters")
	case len(o.Occasion) > 40:
		return invalid("occasion", "must be at most 40 characters")
	case len(o.ItemIDs) < 1 || len(o.ItemIDs) > MaxOutfitItems:
		return invalid("item_client_ids", "must list 1-%d garments", MaxOutfitItems)
	case len(o.Metadata) > 0 && o.Metadata[0] != '{':
		return invalid("metadata", "must be a JSON object")
	}
	seen := make(map[ClientItemID]bool, len(o.ItemIDs))
	for _, id := range o.ItemIDs {
		if !id.Valid() {
			return invalid("item_client_ids", "contains an invalid id")
		}
		if seen[id] {
			return invalid("item_client_ids", "contains %s twice", id)
		}
		seen[id] = true
	}
	return nil
}

type Outfit struct {
	ID             string         `json:"id"`
	ClientOutfitID ClientOutfitID `json:"client_outfit_id"`
	Name           string         `json:"name"`
	Occasion       *string        `json:"occasion"`
	ItemIDs        []ClientItemID `json:"item_client_ids"`
	Metadata       Metadata       `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
}
