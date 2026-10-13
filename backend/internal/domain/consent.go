package domain

import "time"

// Purpose is one thing the user can consent to. DPDP Act 2023 s.6 requires consent to be
// specific to each purpose, so the app asks for each separately.
type Purpose string

const (
	// PurposeCore is storing the wardrobe and Digital Twin to provide the app at all.
	PurposeCore Purpose = "core"
	// PurposeCloudSync is backing up cutouts, colours and style vectors to this server.
	PurposeCloudSync Purpose = "cloud_sync"
	// PurposeCloudProcessing is sending a photo here when the phone cannot run the models.
	PurposeCloudProcessing Purpose = "cloud_processing"
	// PurposeAIStylist is sending a wardrobe summary and chat messages to an LLM provider.
	PurposeAIStylist Purpose = "ai_stylist"
	// PurposeAnalytics is anonymous usage telemetry.
	PurposeAnalytics Purpose = "analytics"
)

var purposes = map[Purpose]bool{
	PurposeCore: true, PurposeCloudSync: true, PurposeCloudProcessing: true, PurposeAIStylist: true, PurposeAnalytics: true,
}

// Consent is one decision the user made in the consent sheet or privacy settings. Records
// are append-only, so the latest one per user is in force and the history is the audit trail.
type Consent struct {
	UserID        UserID           `json:"user_id"`
	NoticeVersion string           `json:"notice_version"`
	Language      Language         `json:"language"`
	Purposes      map[Purpose]bool `json:"purposes"`
	RecordedAt    time.Time        `json:"recorded_at"`
}

func (c Consent) Validate() error {
	switch {
	case !c.UserID.Valid():
		return invalid("user_id", "must be a UUID")
	case c.NoticeVersion == "" || len(c.NoticeVersion) > 32:
		return invalid("notice_version", "must be 1-32 characters")
	case !c.Language.Valid():
		return invalid("language", "must be en, hi or ml")
	}
	for p := range c.Purposes {
		if !purposes[p] {
			return invalid("purposes", "has unknown purpose %q", p)
		}
	}
	return nil
}

// Allows reports whether the user consented to p.
func (c Consent) Allows(p Purpose) bool { return c.Purposes[p] }
