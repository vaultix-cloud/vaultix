// Package importer brings a customer's data from another product into Vaultix (docs/0127).
// Each source has an adapter that reads whatever its API returns and normalizes it into a
// Snapshot, the one source-neutral model the Vaultix side imports from. When Vaultix changes,
// only the mapping from Snapshot changes; no source's shape reaches Vaultix.
//
// A Snapshot lives in server memory for one review or import. Secret values are never part of
// its JSON form, so a review can be returned to a person or logged without carrying a value.
package importer

import "time"

// Source records which product, address and API versions a snapshot was read from, because
// the same source behaves differently between its API versions (docs/0128).
type Source struct {
	Kind        string            `json:"kind"`
	Address     string            `json:"address"`
	APIVersions map[string]string `json:"apiVersions"`
	ReadAt      time.Time         `json:"readAt"`
}

type Snapshot struct {
	Source   Source    `json:"source"`
	Projects []Project `json:"projects"`
	// Gaps are things the source holds that this import does not bring, each with a reason
	// code and what to do instead. Nothing is dropped without a gap.
	Gaps []Gap `json:"gaps"`
}

type Project struct {
	SourceID     string        `json:"sourceId"`
	Name         string        `json:"name"`
	Slug         string        `json:"slug"`
	Environments []Environment `json:"environments"`
}

// Environment may inherit from a parent environment: Doppler branch configs import this way
// (owner decision 2026-11-14). Infisical environments have no parent.
type Environment struct {
	SourceID string   `json:"sourceId"`
	Name     string   `json:"name"`
	Slug     string   `json:"slug"`
	Parent   string   `json:"parent,omitempty"`
	Folders  []string `json:"folders"`
	Secrets  []Secret `json:"secrets"`
}

// Address is where a secret lives within a project, as a structured object rather than one
// string to parse (owner decision 2026-11-14).
type Address struct {
	Environment string `json:"environment"`
	Folder      string `json:"folder"`
	Name        string `json:"name"`
}

type Secret struct {
	Address  Address  `json:"address"`
	Value    string   `json:"-"`
	Comment  string   `json:"comment,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Metadata []Pair   `json:"metadata,omitempty"`
	// References the value makes to other secrets, translated from the source's syntax so
	// the Vaultix side can rewrite them to its own form.
	References []Reference `json:"references,omitempty"`
}

type Pair struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type Reference struct {
	Source string  `json:"source"`
	Target Address `json:"target"`
}

// Gap reasons. A review shows each with its message and what to do instead.
const (
	GapUnreadable   = "unreadable"   // the source identity may not read this value
	GapUnsupported  = "unsupported"  // this kind is not imported yet or has no Vaultix home
	GapReissue      = "reissue"      // a credential the source will not export; issue it again in Vaultix
	GapPersonal     = "personal"     // a person's own override; theirs to bring, not the importer's
	GapUnresolvable = "unresolvable" // a reference whose target is not in the snapshot
)

type Gap struct {
	Kind    string `json:"kind"`
	Reason  string `json:"reason"`
	Where   string `json:"where"`
	Message string `json:"message"`
}
