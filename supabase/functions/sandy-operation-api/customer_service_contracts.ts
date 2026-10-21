// Fixed contracts derived from reviewed application branches; not a discovery catalogue.
export const customerServiceContracts: Record<string, Record<string, unknown>> =
  {
    "social.people.list": {
      "handler": "sandy-social-graph-api",
      "action": "list",
      "body_mode": "payload",
      "authorization": "portal",
      "is_mutation": false,
      "permission_scope": "memory:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "people": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "connections": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "people",
          "connections",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
      ],
      "backend_version": 4,
      "backend_source_sha256":
        "ec38636a09c17011883a66c6480d71b8c044033e6b254ec8da8f4777e7206619",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-social-graph-api action list; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "social.people.create": {
      "handler": "sandy-social-graph-api",
      "action": "create_person",
      "body_mode": "payload",
      "authorization": "portal",
      "is_mutation": true,
      "permission_scope": "memory:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
          },
          "group": {
            "type": "string",
            "enum": [
              "family",
              "friends",
              "work",
              "professional",
              "other",
            ],
          },
        },
        "required": [
          "name",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "person": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "person",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
      ],
      "backend_version": 4,
      "backend_source_sha256":
        "ec38636a09c17011883a66c6480d71b8c044033e6b254ec8da8f4777e7206619",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-social-graph-api action create_person; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "social.people.update": {
      "handler": "sandy-social-graph-api",
      "action": "update_person",
      "body_mode": "payload",
      "authorization": "portal",
      "is_mutation": true,
      "permission_scope": "memory:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
          },
          "group": {
            "type": "string",
            "enum": [
              "family",
              "friends",
              "work",
              "professional",
              "other",
            ],
          },
          "notes": {
            "type": "string",
            "minLength": 0,
            "maxLength": 2000,
          },
        },
        "required": [
          "id",
        ],
        "additionalProperties": false,
        "minProperties": 2,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
      ],
      "backend_version": 4,
      "backend_source_sha256":
        "ec38636a09c17011883a66c6480d71b8c044033e6b254ec8da8f4777e7206619",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-social-graph-api action update_person; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "social.relationships.create": {
      "handler": "sandy-social-graph-api",
      "action": "link",
      "body_mode": "payload",
      "authorization": "portal",
      "is_mutation": true,
      "permission_scope": "memory:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "person_id": {
            "type": "string",
            "format": "uuid",
          },
          "related_person_id": {
            "type": "string",
            "format": "uuid",
          },
          "relationship": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120,
          },
        },
        "required": [
          "person_id",
          "relationship",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "link": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "link",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
      ],
      "backend_version": 4,
      "backend_source_sha256":
        "ec38636a09c17011883a66c6480d71b8c044033e6b254ec8da8f4777e7206619",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-social-graph-api action link; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "social.relationships.delete": {
      "handler": "sandy-social-graph-api",
      "action": "unlink",
      "body_mode": "payload",
      "authorization": "portal",
      "is_mutation": true,
      "permission_scope": "memory:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
      ],
      "backend_version": 4,
      "backend_source_sha256":
        "ec38636a09c17011883a66c6480d71b8c044033e6b254ec8da8f4777e7206619",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-social-graph-api action unlink; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.timezone.get": {
      "rpc": "sandy_api_calendar_timezone_get",
      "handler": "sandy-calendar-api",
      "action": "timezone_get",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": false,
      "permission_scope": "calendar:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "profile": {
            "type": [
              "object",
              "null",
            ],
          },
        },
        "required": [
          "ok",
          "contract_version",
          "profile",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action timezone_get; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.timezone.set_home": {
      "handler": "sandy-calendar-api",
      "action": "timezone_set_home",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "timezone": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[A-Za-z0-9_+./-]+$",
          },
        },
        "required": [
          "timezone",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action timezone_set_home; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.timezone.observe": {
      "handler": "sandy-calendar-api",
      "action": "timezone_observe",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "timezone": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[A-Za-z0-9_+./-]+$",
          },
        },
        "required": [
          "timezone",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action timezone_observe; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.sources.reconcile": {
      "handler": "sandy-calendar-api",
      "action": "sources",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "sources": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "connections": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "sync_operational": {
            "type": "boolean",
          },
          "activation_pending": {
            "type": "boolean",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "sources",
          "connections",
          "sync_operational",
          "activation_pending",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action sources; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.sources.preferences": {
      "handler": "sandy-calendar-api",
      "action": "source_preferences",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "source_id": {
            "type": "string",
            "format": "uuid",
          },
          "visible_by_default": {
            "type": "boolean",
          },
          "include_in_availability": {
            "type": "boolean",
          },
          "is_default_destination": {
            "type": "boolean",
          },
        },
        "required": [
          "source_id",
        ],
        "additionalProperties": false,
        "minProperties": 2,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action source_preferences; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.overview": {
      "handler": "sandy-calendar-api",
      "action": "list",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": false,
      "permission_scope": "calendar:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "events": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "links": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "tasks": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "proposals": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "suggestions": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "events",
          "links",
          "tasks",
          "proposals",
          "suggestions",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action list; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.attachments.list": {
      "handler": "sandy-calendar-api",
      "action": "attachments",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": false,
      "permission_scope": "calendar:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "event_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "event_id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "attachments": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "attachments",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action attachments; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.attachments.prepare": {
      "handler": "sandy-calendar-api",
      "action": "upload",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "event_id": {
            "type": "string",
            "format": "uuid",
          },
          "file_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 250,
          },
          "byte_size": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10485760,
          },
          "content_type": {
            "type": "string",
            "enum": [
              "application/pdf",
              "image/jpeg",
              "image/png",
              "image/webp",
              "text/plain",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ],
          },
        },
        "required": [
          "event_id",
          "file_name",
          "byte_size",
          "content_type",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "file_id": {
            "type": "string",
            "format": "uuid",
          },
          "path": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000,
          },
          "token": {
            "type": "string",
            "minLength": 1,
            "maxLength": 10000,
          },
          "signed_url": {
            "type": "string",
            "format": "uri",
            "pattern": "^https://",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "file_id",
          "path",
          "token",
          "signed_url",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action upload; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.attachments.confirm": {
      "handler": "sandy-calendar-api",
      "action": "finalize_upload",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "event_id": {
            "type": "string",
            "format": "uuid",
          },
          "file_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 250,
          },
          "byte_size": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10485760,
          },
          "content_type": {
            "type": "string",
            "enum": [
              "application/pdf",
              "image/jpeg",
              "image/png",
              "image/webp",
              "text/plain",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ],
          },
          "file_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "event_id",
          "file_name",
          "byte_size",
          "content_type",
          "file_id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "attachment": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "attachment",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action finalize_upload; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.attachments.download": {
      "handler": "sandy-calendar-api",
      "action": "download",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": false,
      "permission_scope": "calendar:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "attachment_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "attachment_id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "url": {
            "type": "string",
            "format": "uri",
            "pattern": "^https://",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "url",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action download; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.attachments.delete": {
      "handler": "sandy-calendar-api",
      "action": "delete_attachment",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "attachment_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "attachment_id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action delete_attachment; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.tasks.reschedule": {
      "handler": "sandy-calendar-api",
      "action": "reschedule_task",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "task_id": {
            "type": "string",
            "format": "uuid",
          },
          "starts_at": {
            "type": "string",
            "format": "date-time",
          },
          "original_start_at": {
            "type": "string",
            "format": "date-time",
          },
          "ends_at": {
            "type": [
              "string",
              "null",
            ],
            "format": "date-time",
          },
          "mode": {
            "type": "string",
            "enum": [
              "schedule",
              "deadline",
            ],
          },
          "move_deadline": {
            "type": "boolean",
          },
          "original_due_at": {
            "type": [
              "string",
              "null",
            ],
            "format": "date-time",
          },
        },
        "required": [
          "task_id",
          "starts_at",
          "original_start_at",
          "mode",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action reschedule_task; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.events.create": {
      "handler": "sandy-calendar-api",
      "action": "create",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 240,
          },
          "starts_at": {
            "type": "string",
            "format": "date-time",
          },
          "ends_at": {
            "type": [
              "string",
              "null",
            ],
            "format": "date-time",
          },
          "all_day": {
            "type": "boolean",
          },
          "timezone": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
          },
          "description": {
            "type": "string",
            "minLength": 0,
            "maxLength": 4000,
          },
          "matter_key": {
            "type": "string",
            "minLength": 0,
            "maxLength": 200,
          },
        },
        "required": [
          "title",
          "starts_at",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "event": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "event",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action create; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.events.update": {
      "handler": "sandy-calendar-api",
      "action": "update",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "event_id": {
            "type": "string",
            "format": "uuid",
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 240,
          },
          "starts_at": {
            "type": "string",
            "format": "date-time",
          },
          "ends_at": {
            "type": [
              "string",
              "null",
            ],
            "format": "date-time",
          },
          "status": {
            "type": "string",
            "enum": [
              "confirmed",
              "tentative",
              "cancelled",
            ],
          },
          "matter_key": {
            "type": [
              "string",
              "null",
            ],
            "maxLength": 200,
          },
        },
        "required": [
          "event_id",
        ],
        "additionalProperties": false,
        "minProperties": 2,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "event": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "event",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action update; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.tasks.link": {
      "handler": "sandy-calendar-api",
      "action": "link",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "task_id": {
            "type": "string",
            "format": "uuid",
          },
          "event_id": {
            "type": "string",
            "format": "uuid",
          },
          "offset_days": {
            "type": "integer",
            "minimum": -3650,
            "maximum": 3650,
          },
        },
        "required": [
          "task_id",
          "event_id",
          "offset_days",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action link; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "calendar.client.reviews.decide": {
      "handler": "sandy-calendar-api",
      "action": "review",
      "body_mode": "payload",
      "authorization": "agenda",
      "is_mutation": true,
      "permission_scope": "calendar:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "review_id": {
            "type": "string",
            "format": "uuid",
          },
          "decision": {
            "type": "string",
            "enum": [
              "dismiss",
              "apply",
            ],
          },
        },
        "required": [
          "review_id",
          "decision",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        148,
        153,
        156,
      ],
      "backend_version": 21,
      "backend_source_sha256":
        "9d14bd8a2613e4a6e951635e55225be2b2de890ce80b17844f0f756bf47a92b1",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-calendar-api action review; actual user session and agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "files.library.list": {
      "handler": "sandy-files",
      "action": "list",
      "body_mode": "flat",
      "authorization": "portal",
      "is_mutation": false,
      "permission_scope": "files:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "minLength": 0,
            "maxLength": 200,
          },
        },
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "files": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "total": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "files",
          "total",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        156,
      ],
      "backend_version": 12,
      "backend_source_sha256":
        "f718cebfa843f5d6e47e270ca7a394423bf323ea79bd5dad3b740c2080bd6689",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-files action list; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "files.library.history": {
      "handler": "sandy-files",
      "action": "history",
      "body_mode": "flat",
      "authorization": "portal",
      "is_mutation": false,
      "permission_scope": "files:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "file_id": {
            "type": "string",
            "format": "uuid",
          },
          "history": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "merged_copies": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000,
          },
          "recorded_sources": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000,
          },
          "recorded_usages": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000,
          },
          "complete": {
            "const": false,
          },
          "coverage_note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "file_id",
          "history",
          "merged_copies",
          "recorded_sources",
          "recorded_usages",
          "complete",
          "coverage_note",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        156,
      ],
      "backend_version": 12,
      "backend_source_sha256":
        "f718cebfa843f5d6e47e270ca7a394423bf323ea79bd5dad3b740c2080bd6689",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-files action history; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "files.library.description.set": {
      "handler": "sandy-files",
      "action": "set_description",
      "body_mode": "flat",
      "authorization": "portal",
      "is_mutation": true,
      "permission_scope": "files:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "description": {
            "type": "string",
            "minLength": 0,
            "maxLength": 4000,
          },
        },
        "required": [
          "id",
          "description",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "description": {
            "type": "string",
            "minLength": 0,
            "maxLength": 4000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "description",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        156,
      ],
      "backend_version": 12,
      "backend_source_sha256":
        "f718cebfa843f5d6e47e270ca7a394423bf323ea79bd5dad3b740c2080bd6689",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-files action set_description; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "files.library.state.set": {
      "handler": "sandy-files",
      "action": "set_state",
      "body_mode": "flat",
      "authorization": "portal",
      "is_mutation": true,
      "permission_scope": "files:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "state": {
            "type": "string",
            "enum": [
              "active",
              "archived",
              "trashed",
            ],
          },
        },
        "required": [
          "id",
          "state",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "state": {
            "type": "string",
            "enum": [
              "active",
              "archived",
              "trashed",
            ],
          },
        },
        "required": [
          "ok",
          "contract_version",
          "state",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        156,
      ],
      "backend_version": 12,
      "backend_source_sha256":
        "f718cebfa843f5d6e47e270ca7a394423bf323ea79bd5dad3b740c2080bd6689",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-files action set_state; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "files.library.download": {
      "handler": "sandy-files",
      "action": "open",
      "body_mode": "flat",
      "authorization": "portal",
      "is_mutation": false,
      "permission_scope": "files:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "url": {
            "type": "string",
            "format": "uri",
            "pattern": "^https://",
          },
          "expires_in": {
            "const": 60,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "url",
          "expires_in",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        156,
      ],
      "backend_version": 12,
      "backend_source_sha256":
        "f718cebfa843f5d6e47e270ca7a394423bf323ea79bd5dad3b740c2080bd6689",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-files action open; actual user session and portal authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "task_files.counts": {
      "handler": "sandy-task-files",
      "action": "counts",
      "body_mode": "flat",
      "authorization": "portal_and_agenda",
      "is_mutation": false,
      "permission_scope": "files:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "counts": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "counts",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        153,
        156,
      ],
      "backend_version": 3,
      "backend_source_sha256":
        "0c17a09db4e91be2dd6ca21e40cc96d26b562ec936c0d2f81e9c4345ef220ec7",
      "backend_source_observed": false,
      "description":
        "Fixed sandy-task-files action counts; actual user session and portal_and_agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
      "allow_shared_resources": true,
    },
    "task_files.list": {
      "handler": "sandy-task-files",
      "action": "list",
      "body_mode": "flat",
      "authorization": "portal_and_agenda",
      "is_mutation": false,
      "permission_scope": "files:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "task_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "task_id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "files": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "can_upload": {
            "type": "boolean",
          },
          "can_delete_all": {
            "type": "boolean",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "files",
          "can_upload",
          "can_delete_all",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        153,
        156,
      ],
      "backend_version": 3,
      "backend_source_sha256":
        "0c17a09db4e91be2dd6ca21e40cc96d26b562ec936c0d2f81e9c4345ef220ec7",
      "backend_source_observed": false,
      "description":
        "Fixed sandy-task-files action list; actual user session and portal_and_agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
      "allow_shared_resources": true,
    },
    "task_files.prepare": {
      "handler": "sandy-task-files",
      "action": "prepare",
      "body_mode": "flat",
      "authorization": "portal_and_agenda",
      "is_mutation": true,
      "permission_scope": "files:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "task_id": {
            "type": "string",
            "format": "uuid",
          },
          "filename": {
            "type": "string",
            "minLength": 1,
            "maxLength": 255,
          },
          "size_bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 26214400,
          },
        },
        "required": [
          "task_id",
          "filename",
          "size_bytes",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "path": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000,
          },
          "token": {
            "type": "string",
            "minLength": 1,
            "maxLength": 10000,
          },
          "mime_type": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "id",
          "path",
          "token",
          "mime_type",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        153,
        156,
      ],
      "backend_version": 3,
      "backend_source_sha256":
        "0c17a09db4e91be2dd6ca21e40cc96d26b562ec936c0d2f81e9c4345ef220ec7",
      "backend_source_observed": false,
      "description":
        "Fixed sandy-task-files action prepare; actual user session and portal_and_agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
      "allow_shared_resources": true,
    },
    "task_files.confirm": {
      "handler": "sandy-task-files",
      "action": "complete",
      "body_mode": "flat",
      "authorization": "portal_and_agenda",
      "is_mutation": true,
      "permission_scope": "files:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "task_id": {
            "type": "string",
            "format": "uuid",
          },
          "id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "task_id",
          "id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "file": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "file",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        153,
        156,
      ],
      "backend_version": 3,
      "backend_source_sha256":
        "0c17a09db4e91be2dd6ca21e40cc96d26b562ec936c0d2f81e9c4345ef220ec7",
      "backend_source_observed": false,
      "description":
        "Fixed sandy-task-files action complete; actual user session and portal_and_agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
      "allow_shared_resources": true,
    },
    "task_files.download": {
      "handler": "sandy-task-files",
      "action": "download",
      "body_mode": "flat",
      "authorization": "portal_and_agenda",
      "is_mutation": false,
      "permission_scope": "files:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "task_id": {
            "type": "string",
            "format": "uuid",
          },
          "id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "task_id",
          "id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "url": {
            "type": "string",
            "format": "uri",
            "pattern": "^https://",
          },
          "mime_type": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 255,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "url",
          "mime_type",
          "name",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        153,
        156,
      ],
      "backend_version": 3,
      "backend_source_sha256":
        "0c17a09db4e91be2dd6ca21e40cc96d26b562ec936c0d2f81e9c4345ef220ec7",
      "backend_source_observed": false,
      "description":
        "Fixed sandy-task-files action download; actual user session and portal_and_agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
      "allow_shared_resources": true,
    },
    "task_files.delete": {
      "handler": "sandy-task-files",
      "action": "remove",
      "body_mode": "flat",
      "authorization": "portal_and_agenda",
      "is_mutation": true,
      "permission_scope": "files:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "task_id": {
            "type": "string",
            "format": "uuid",
          },
          "id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "task_id",
          "id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        153,
        156,
      ],
      "backend_version": 3,
      "backend_source_sha256":
        "0c17a09db4e91be2dd6ca21e40cc96d26b562ec936c0d2f81e9c4345ef220ec7",
      "backend_source_observed": false,
      "description":
        "Fixed sandy-task-files action remove; actual user session and portal_and_agenda authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
      "allow_shared_resources": true,
    },
    "controller.context.audit": {
      "handler": "sandy-controller-api",
      "action": "context_audit",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "requests": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "retrievals": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "policies": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "active_grants": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000,
          },
          "summary": {
            "type": "object",
          },
          "limitations": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2000,
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "requests",
          "retrievals",
          "policies",
          "active_grants",
          "summary",
          "limitations",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action context_audit; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.deployment.approvals": {
      "handler": "sandy-controller-api",
      "action": "deployment_approvals",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "jobs": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "write_execution_enabled": {
            "const": false,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "jobs",
          "write_execution_enabled",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action deployment_approvals; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.deployment.approve": {
      "handler": "sandy-controller-api",
      "action": "deployment_approve",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": true,
      "permission_scope": "controller:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "job_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "job_id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "job": {
            "type": "object",
          },
          "execution_started": {
            "const": false,
          },
          "notice": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "job",
          "execution_started",
          "notice",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action deployment_approve; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.overview": {
      "handler": "sandy-controller-api",
      "action": "overview",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "role": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
          },
          "metrics": {
            "type": "object",
          },
          "verifiedTotals": {
            "type": "object",
          },
          "qaSummary": {
            "type": "object",
          },
          "activity": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "qa": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "roadmap": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "integrations": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "moduleStatuses": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "role",
          "metrics",
          "verifiedTotals",
          "qaSummary",
          "activity",
          "qa",
          "roadmap",
          "integrations",
          "moduleStatuses",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action overview; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.efficiency": {
      "handler": "sandy-controller-api",
      "action": "examiner_v31_efficiency",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "mode": {
            "const": "evidence_first",
          },
          "model_calls_for_triage": {
            "const": 0,
          },
          "records_triaged": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000,
          },
          "decisions": {
            "type": "object",
          },
          "deduplicated_cases": {
            "type": "object",
          },
          "distinct_fault_signatures": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000,
          },
          "queue_is_advisory": {
            "const": true,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "mode",
          "model_calls_for_triage",
          "records_triaged",
          "decisions",
          "deduplicated_cases",
          "distinct_fault_signatures",
          "queue_is_advisory",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_v31_efficiency; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.acceptance": {
      "handler": "sandy-controller-api",
      "action": "examiner_v3_acceptance",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "items",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_v3_acceptance; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.results": {
      "handler": "sandy-controller-api",
      "action": "examiner_v3_results",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "version": {
            "const": 3,
          },
          "active": {
            "const": true,
          },
          "investigations": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "fallback": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500,
          },
          "production_ready": {
            "type": "boolean",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "version",
          "active",
          "investigations",
          "fallback",
          "production_ready",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_v3_results; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.run": {
      "handler": "sandy-controller-api",
      "action": "examiner_v3_run",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": true,
      "permission_scope": "controller:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "channel": {
            "type": "string",
            "enum": [
              "email",
              "whatsapp",
            ],
          },
          "source_id": {
            "type": "string",
            "pattern": "^[-A-Za-z0-9]{1,90}$",
          },
        },
        "required": [
          "channel",
          "source_id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "http_status": {
            "type": "integer",
            "minimum": 200,
            "maximum": 299,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "http_status",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": true,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_v3_run; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.production.run": {
      "handler": "sandy-controller-api",
      "action": "examiner_production_run",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": true,
      "permission_scope": "controller:write",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "run_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
          },
          "status": {
            "const": "running",
          },
          "mode": {
            "const": "mandatory_full_cycle_v2",
          },
          "minimum_tests": {
            "const": 10,
          },
          "review_channels": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100,
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "run_key",
          "status",
          "mode",
          "minimum_tests",
          "review_channels",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": true,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_production_run; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
      "sends_external_communications": true,
    },
    "controller.examiner.account": {
      "handler": "sandy-controller-api",
      "action": "examiner_production_account",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "account": {
            "type": "string",
            "minLength": 1,
            "maxLength": 320,
          },
          "connection_state": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
          },
          "verified_at": {
            "type": [
              "string",
              "null",
            ],
            "format": "date-time",
          },
          "services": {
            "type": "object",
          },
          "runs": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "generated_at": {
            "type": "string",
            "format": "date-time",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "account",
          "connection_state",
          "verified_at",
          "services",
          "runs",
          "generated_at",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_production_account; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.report": {
      "handler": "sandy-controller-api",
      "action": "examiner_readable_report",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "run_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
          },
        },
        "required": [
          "run_key",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "run_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
          },
          "run": {
            "type": [
              "object",
              "null",
            ],
          },
          "generated_tests": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "production_threads": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "production_history": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "summary": {
            "type": "object",
          },
          "limits": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "run_key",
          "run",
          "generated_tests",
          "production_threads",
          "production_history",
          "summary",
          "limits",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_readable_report; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.runs": {
      "handler": "sandy-controller-api",
      "action": "examiner_runs",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 10,
            "maximum": 100,
          },
        },
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "totals": {
            "type": "object",
          },
          "generated_at": {
            "type": "string",
            "format": "date-time",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "items",
          "totals",
          "generated_at",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_runs; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.run.get": {
      "handler": "sandy-controller-api",
      "action": "examiner_run_detail",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "run_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
          },
        },
        "required": [
          "run_key",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "run_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
          },
          "audits": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "executions": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "independent_reviews": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "production_reviews": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "thread_reviews": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "design": {
            "type": [
              "object",
              "null",
            ],
          },
          "assurance": {
            "type": [
              "object",
              "null",
            ],
          },
          "limits": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "run_key",
          "audits",
          "executions",
          "independent_reviews",
          "production_reviews",
          "thread_reviews",
          "design",
          "assurance",
          "limits",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_run_detail; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.examiner.production.list": {
      "handler": "sandy-controller-api",
      "action": "examiner_production",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "channel": {
            "type": "string",
            "enum": [
              "all",
              "email",
              "web",
              "whatsapp",
              "voice",
            ],
          },
          "page": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000,
          },
        },
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "count": {
            "type": [
              "integer",
              "null",
            ],
          },
          "limit": {
            "const": 50,
          },
          "page": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000,
          },
          "generated_at": {
            "type": "string",
            "format": "date-time",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "items",
          "count",
          "limit",
          "page",
          "generated_at",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action examiner_production; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.supervisor.work": {
      "handler": "sandy-controller-api",
      "action": "supervisor_work",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "jobs": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "outcomes": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "jobs",
          "outcomes",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action supervisor_work; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.supervisor.investigate": {
      "handler": "sandy-controller-api",
      "action": "supervisor_investigate",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": true,
      "permission_scope": "controller:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "finding_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "finding_id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "job": {
            "type": [
              "object",
              "null",
            ],
          },
        },
        "required": [
          "ok",
          "contract_version",
          "job",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action supervisor_investigate; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.supervisor.jobs.update": {
      "handler": "sandy-controller-api",
      "action": "supervisor_job_update",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": true,
      "permission_scope": "controller:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "status": {
            "type": "string",
            "enum": [
              "investigating",
              "proposal_ready",
              "testing",
              "verified",
              "rejected",
              "blocked",
            ],
          },
          "verification": {
            "type": "object",
            "properties": {
              "test_reference": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
              },
              "observed_result": {
                "type": "string",
                "minLength": 1,
                "maxLength": 4000,
              },
              "deployment_reference": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
              },
            },
            "required": [],
            "additionalProperties": false,
          },
        },
        "required": [
          "id",
          "status",
        ],
        "additionalProperties": false,
        "allOf": [
          {
            "if": {
              "properties": {
                "status": {
                  "const": "verified",
                },
              },
              "required": [
                "status",
              ],
            },
            "then": {
              "properties": {
                "verification": {
                  "type": "object",
                  "properties": {
                    "test_reference": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000,
                    },
                    "observed_result": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 4000,
                    },
                    "deployment_reference": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000,
                    },
                  },
                  "required": [
                    "test_reference",
                    "observed_result",
                    "deployment_reference",
                  ],
                  "additionalProperties": false,
                },
              },
              "required": [
                "verification",
              ],
            },
          },
        ],
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "job": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "job",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action supervisor_job_update; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.supervisor.overview": {
      "handler": "sandy-controller-api",
      "action": "supervisor",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "observations": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "assessments": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "evaluations": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "metrics": {
            "type": "object",
          },
          "limits": {
            "type": "object",
          },
          "note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 3000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "observations",
          "findings",
          "assessments",
          "evaluations",
          "metrics",
          "limits",
          "note",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action supervisor; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.missions.list": {
      "handler": "sandy-controller-api",
      "action": "mission_control",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "counts": {
            "type": "object",
          },
          "missions": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "runs": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "improvements": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "limits": {
            "type": "object",
          },
          "note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 3000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "counts",
          "missions",
          "runs",
          "improvements",
          "limits",
          "note",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action mission_control; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.missions.get": {
      "handler": "sandy-controller-api",
      "action": "mission_inspect",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "id",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "mission": {
            "type": "object",
          },
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "runs": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "questions": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "decisions": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "events": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "products": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "mission",
          "steps",
          "runs",
          "questions",
          "decisions",
          "events",
          "products",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action mission_inspect; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.activity": {
      "handler": "sandy-controller-api",
      "action": "activity",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "format": "date-time",
          },
          "limit": {
            "type": "integer",
            "minimum": 10,
            "maximum": 100,
          },
        },
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "next_cursor": {
            "type": [
              "string",
              "null",
            ],
            "format": "date-time",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "items",
          "next_cursor",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action activity; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.qa.update": {
      "handler": "sandy-controller-api",
      "action": "qa_update",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": true,
      "permission_scope": "controller:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "needs_review",
              "retest_pending",
              "passed",
              "failed",
              "investigating",
            ],
          },
        },
        "required": [
          "id",
          "status",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "item": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "item",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action qa_update; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.self_tasks.list": {
      "handler": "sandy-controller-api",
      "action": "self_tasks_list",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": false,
      "permission_scope": "controller:read",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "tasks": {
            "type": "array",
            "items": {
              "type": "object",
            },
          },
          "read_only": {
            "type": "boolean",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "tasks",
          "read_only",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": true,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action self_tasks_list; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
    "controller.self_tasks.update": {
      "handler": "sandy-controller-api",
      "action": "self_tasks_update",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": true,
      "permission_scope": "controller:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "notes": {
            "type": "string",
            "minLength": 0,
            "maxLength": 12000,
          },
          "status": {
            "type": "string",
            "enum": [
              "intake",
              "evaluating",
              "approved",
              "rejected",
              "planned",
              "in_progress",
              "testing",
              "deployed",
              "blocked",
            ],
          },
          "decision_reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4000,
          },
        },
        "required": [
          "id",
        ],
        "additionalProperties": false,
        "minProperties": 2,
        "allOf": [
          {
            "if": {
              "properties": {
                "status": {
                  "const": "rejected",
                },
              },
              "required": [
                "status",
              ],
            },
            "then": {
              "properties": {
                "decision_reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 4000,
                },
              },
              "required": [
                "decision_reason",
              ],
            },
          },
        ],
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action self_tasks_update; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
      "known_backend_dependency": "undefined_uuid_helper_in_observed_v34",
    },
    "controller.roadmap.update": {
      "handler": "sandy-controller-api",
      "action": "roadmap_update",
      "body_mode": "op",
      "authorization": "controller_owner",
      "is_mutation": true,
      "permission_scope": "controller:write",
      "input_schema": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
          },
          "progress": {
            "type": "string",
            "enum": [
              "planned",
              "partial",
              "validated",
              "in_progress",
              "blocked",
              "testing",
              "completed",
              "proposed",
              "pending",
            ],
          },
        },
        "required": [
          "key",
          "progress",
        ],
        "additionalProperties": false,
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": {
            "const": true,
          },
          "contract_version": {
            "const": "1.0.0",
          },
          "item": {
            "type": "object",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "item",
        ],
        "additionalProperties": true,
      },
      "accept_legacy_without_ok": false,
      "consumes_model_resources": false,
      "requirement_ids": [
        155,
      ],
      "backend_version": 34,
      "backend_source_sha256":
        "24c8a473d50531b5baae6122e2b136d951c4ac658eef6bb66ff95b07a50041bf",
      "backend_source_observed": true,
      "description":
        "Fixed sandy-controller-api action roadmap_update; actual user session and controller_owner authorization, independently scoped application service. Contract v1.0.0; provider acceptance/recorded evidence is not verified outcome.",
    },
  };
