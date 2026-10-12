// Package db embeds schema.sql so the server can bootstrap an empty database.
package db

import _ "embed"

//go:embed schema.sql
var Schema string
