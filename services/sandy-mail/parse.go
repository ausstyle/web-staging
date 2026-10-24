package mailstore

import (
	"bytes"
	"fmt"
	"html"
	"io"
	"time"

	"github.com/emersion/go-message"
	_ "github.com/emersion/go-message/charset"
	"github.com/emersion/go-message/mail"
)

type Attachment struct {
	Name      string
	Type      string
	ContentID string
	Data      []byte
	Object    Object
}
type Recipient struct{ Kind, Name, Address string }
type Parsed struct {
	Recipients  []Recipient
	Subject     string
	MessageID   string
	Headers     map[string][]string
	Date        *time.Time
	Text        string
	HTML        string
	DisplayHTML string
	Attachments []Attachment
}

func Parse(raw []byte) (Parsed, error) {
	var p Parsed
	if len(raw) == 0 || len(raw) > MaxMessageBytes {
		return p, fmt.Errorf("message_size_limit")
	}
	// First validate nesting before the mail reader's flattened walk.
	ent, err := message.Read(bytes.NewReader(raw))
	if err != nil {
		return p, fmt.Errorf("invalid_mime")
	}
	parts := 0
	var walk func(*message.Entity, int) error
	walk = func(e *message.Entity, depth int) error {
		parts++
		if depth > 20 || parts > 200 {
			return fmt.Errorf("mime_complexity_limit")
		}
		mr := e.MultipartReader()
		if mr == nil {
			_, err := io.Copy(io.Discard, io.LimitReader(e.Body, MaxMessageBytes+1))
			return err
		}
		defer mr.Close()
		for {
			child, err := mr.NextPart()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return fmt.Errorf("invalid_mime")
			}
			if err = walk(child, depth+1); err != nil {
				return err
			}
		}
	}
	if err = walk(ent, 0); err != nil {
		return p, err
	}
	r, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil {
		return p, fmt.Errorf("invalid_mime")
	}
	defer r.Close()
	p.Subject, err = r.Header.Subject()
	if err != nil {
		return p, fmt.Errorf("invalid_subject")
	}
	p.MessageID = r.Header.Get("Message-ID")
	p.Headers = map[string][]string{}
	for f := r.Header.Fields(); f.Next(); {
		p.Headers[f.Key()] = append(p.Headers[f.Key()], f.Value())
	}
	if d, err := r.Header.Date(); err == nil {
		p.Date = &d
	}
	for _, kind := range []string{"From", "Sender", "Reply-To", "To", "Cc", "Bcc"} {
		if r.Header.Get(kind) == "" {
			continue
		}
		addresses, err := r.Header.AddressList(kind)
		if err != nil {
			return p, fmt.Errorf("invalid_address_header")
		}
		for _, a := range addresses {
			p.Recipients = append(p.Recipients, Recipient{kind, a.Name, a.Address})
		}
	}
	decodedBytes := 0
	for {
		part, err := r.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return p, fmt.Errorf("invalid_mime_part")
		}
		b, err := io.ReadAll(io.LimitReader(part.Body, MaxMessageBytes+1))
		if err != nil || len(b) > MaxMessageBytes {
			return p, fmt.Errorf("invalid_mime_part")
		}
		decodedBytes += len(b)
		if decodedBytes > MaxMessageBytes {
			return p, fmt.Errorf("decoded_size_limit")
		}
		switch h := part.Header.(type) {
		case *mail.InlineHeader:
			typ, _, err := h.ContentType()
			if err != nil {
				return p, fmt.Errorf("invalid_content_type")
			}
			if typ == "text/plain" {
				p.Text += string(b) + "\n"
			} else if typ == "text/html" {
				p.HTML += string(b) + "\n"
			} else {
				p.Attachments = append(p.Attachments, Attachment{Type: typ, ContentID: h.Get("Content-ID"), Data: b})
			}
		case *mail.AttachmentHeader:
			name, err := h.Filename()
			if err != nil {
				return p, fmt.Errorf("invalid_filename")
			}
			typ, _, err := h.ContentType()
			if err != nil {
				return p, fmt.Errorf("invalid_content_type")
			}
			p.Attachments = append(p.Attachments, Attachment{Name: name, Type: typ, ContentID: h.Get("Content-ID"), Data: b})
		default:
			return p, fmt.Errorf("unsupported_mime_part")
		}
	}
	// Conservative display projection: no remote resources or active source HTML.
	display := p.Text
	if display == "" {
		display = p.HTML
	}
	p.DisplayHTML = "<pre>" + html.EscapeString(display) + "</pre>"
	return p, nil
}
