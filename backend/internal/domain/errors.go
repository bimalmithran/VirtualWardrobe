// Package domain holds the wardrobe's entities and their invariants. It has no I/O and
// no dependencies on other internal packages; every other layer depends on it.
package domain

import (
	"errors"
	"fmt"
)

var (
	// ErrUserNotFound means the referenced Digital Twin has not been saved yet.
	ErrUserNotFound = errors.New("user not found; POST /api/users/profile first")
	// ErrUnknownCategory means a category slug does not exist.
	ErrUnknownCategory = errors.New("unknown category_slug")
	// ErrUnknownItems means an outfit references garments the server has not received yet.
	ErrUnknownItems = errors.New("outfit references garments that have not been uploaded")
	// ErrNotFound means the addressed resource does not exist for this user.
	ErrNotFound = errors.New("not found")
	// ErrUnauthorized means the request carries no valid device credentials (or the device
	// is not enrolled yet).
	ErrUnauthorized = errors.New("device not enrolled or credentials missing")
	// ErrForbidden means the credentials do not belong to the user the request acts for.
	ErrForbidden = errors.New("credentials do not match this user")
	// ErrConsentRequired means the user has not consented to the purpose the request needs.
	ErrConsentRequired = errors.New("consent for this purpose has not been given")
	// ErrQuotaExceeded means a free-tier limit was reached.
	ErrQuotaExceeded = errors.New("free plan limit reached")
)

// ValidationError reports a rejected input field. Transport layers map it to a 4xx.
type ValidationError struct {
	Field  string
	Reason string
}

func (e *ValidationError) Error() string { return fmt.Sprintf("%s %s", e.Field, e.Reason) }

func invalid(field, reason string, args ...any) error {
	return &ValidationError{Field: field, Reason: fmt.Sprintf(reason, args...)}
}

// IsValidation reports whether err is (or wraps) a ValidationError.
func IsValidation(err error) bool {
	var v *ValidationError
	return errors.As(err, &v)
}
