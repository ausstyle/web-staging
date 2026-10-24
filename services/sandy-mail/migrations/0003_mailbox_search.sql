-- Derived indexes only; mailbox/source bytes and immutable receipts are unchanged.
-- Larger search architectures require measured query plans, not pre-emptive shards.
CREATE INDEX message_subject_fts ON core.messages USING gin (to_tsvector('simple',subject));
CREATE INDEX message_body_fts ON core.bodies USING gin (to_tsvector('simple',text_body));
