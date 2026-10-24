package mailstore

import (
	"bytes"
	"io"
	"testing"
	"time"
)

func TestMBOXRDLosslessAndResumable(t *testing.T) {
	raw := []byte("From: sender@example.invalid\r\nTo: fixture@example.invalid\r\nSubject: synthetic mbox\r\n\r\nFrom sender@example.invalid Sat Oct 24 00:00:00 2026\r\n>From quoted\n>>From deeper\nlast\n\n")
	var b bytes.Buffer
	date := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	first, e := WriteMBOXRD(&b, raw, "sender@example.invalid", date)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = WriteMBOXRD(&b, SyntheticFixture, "sender@example.invalid", date); e != nil {
		t.Fatal(e)
	}
	rec, e := NextMBOXRD(bytes.NewReader(b.Bytes()), int64(b.Len()), 0, time.UTC)
	if e != nil || !bytes.Equal(rec.Raw, raw) || rec.Next != first {
		t.Fatalf("first roundtrip offset=%d %v", rec.Next, e)
	}
	rec, e = NextMBOXRD(bytes.NewReader(b.Bytes()), int64(b.Len()), rec.Next, time.UTC)
	if e != nil || !bytes.Equal(rec.Raw, SyntheticFixture) || rec.Next != int64(b.Len()) {
		t.Fatalf("resume %v", e)
	}
	if _, e = NextMBOXRD(bytes.NewReader(b.Bytes()), int64(b.Len()), rec.Next, time.UTC); e != io.EOF {
		t.Fatal("EOF missing")
	}
}
func TestMBOXRDAmbiguityFailsClosed(t *testing.T) {
	for _, input := range []string{"garbage\n", "From a unsupported date\n", "From a Sat Oct 24 00:00:00 2026\nSubject: x\n\nbody\n", "From a Sat Oct 24 00:00:00 2026\nContent-Length: 3\n\na\n\n", "From a Sat Oct 24 00:00:00 2026\nSubject: x\n\nFrom unescaped ambiguous body\n\n"} {
		if _, e := NextMBOXRD(bytes.NewReader([]byte(input)), int64(len(input)), 0, time.UTC); e == nil {
			t.Fatalf("accepted ambiguous source %q", input)
		}
	}
	if _, e := WriteMBOXRD(io.Discard, []byte("Subject: x\n\nno newline"), "a", time.Now()); e == nil {
		t.Fatal("silently normalized source")
	}
}
