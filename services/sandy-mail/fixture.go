package mailstore

import _ "embed"

// SyntheticFixture contains only .invalid addresses and invented content.
//
//go:embed testdata/first-email.eml
var SyntheticFixture []byte
