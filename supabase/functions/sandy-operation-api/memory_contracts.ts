import { memoryCorrectionMutationContract } from "./customer_mutations.ts";
// Remaining actual Memory Portal branches; baseline five passive reads stay separate.
export const memoryOperationContracts: Record<string, Record<string, unknown>> =
  {
    "memory.report_error": {
      "handler": "sandy-memory-centre",
      "action": "report_error",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "source": {
            "type": "string",
            "enum": [
              "browser",
              "api",
            ],
          },
          "operation": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
          },
          "code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
          },
          "component": {
            "type": "string",
            "minLength": 0,
            "maxLength": 60,
          },
        },
        "required": [
          "source",
          "operation",
          "code",
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
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action report_error as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.biography": {
      "handler": "sandy-memory-centre",
      "action": "biography",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
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
          "paragraphs": {
            "type": "array",
            "maxItems": 4,
            "items": {
              "type": "object",
              "properties": {
                "text": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 850,
                },
                "source_ids": {
                  "type": "array",
                  "minItems": 1,
                  "maxItems": 5,
                  "uniqueItems": true,
                  "items": {
                    "type": "string",
                    "format": "uuid",
                  },
                },
              },
              "required": [
                "text",
                "source_ids",
              ],
              "additionalProperties": false,
            },
          },
          "sources": {
            "type": "array",
            "maxItems": 20,
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "paragraphs",
          "sources",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": true,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action biography as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.search": {
      "handler": "sandy-memory-centre",
      "action": "search",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "minLength": 2,
            "maxLength": 300,
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 24,
          },
        },
        "required": [
          "query",
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
          "matches": {
            "type": "array",
            "maxItems": 24,
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "matches",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": true,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action search as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.ask": {
      "handler": "sandy-memory-centre",
      "action": "ask",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "minLength": 4,
            "maxLength": 600,
          },
          "history": {
            "type": "array",
            "maxItems": 10,
            "items": {
              "type": "object",
              "properties": {
                "role": {
                  "type": "string",
                  "enum": [
                    "user",
                    "assistant",
                  ],
                },
                "content": {
                  "type": "string",
                  "minLength": 0,
                  "maxLength": 1200,
                },
              },
              "required": [
                "role",
                "content",
              ],
              "additionalProperties": false,
            },
          },
          "timezone": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
          },
        },
        "required": [
          "query",
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
          "answer": {
            "type": "string",
            "minLength": 0,
            "maxLength": 7000,
          },
          "sources": {
            "type": "array",
            "maxItems": 7,
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "answer",
          "sources",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": true,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action ask as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
      "can_create_customer_tasks": true,
    },
    "memory.life_search": {
      "handler": "sandy-memory-centre",
      "action": "life_search",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "minLength": 2,
            "maxLength": 500,
          },
          "space_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "query",
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
          "results": {
            "type": "array",
            "maxItems": 20,
            "items": {
              "type": "object",
            },
          },
        },
        "required": [
          "ok",
          "contract_version",
          "results",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": true,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action life_search as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.life_goal": {
      "handler": "sandy-memory-centre",
      "action": "life_goal",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "space_id": {
            "type": "string",
            "format": "uuid",
          },
          "title": {
            "type": "string",
            "minLength": 2,
            "maxLength": 250,
          },
          "area_key": {
            "type": "string",
            "minLength": 0,
            "maxLength": 60,
          },
        },
        "required": [
          "space_id",
          "title",
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
        },
        "required": [
          "ok",
          "contract_version",
          "id",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action life_goal as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.life_task": {
      "handler": "sandy-memory-centre",
      "action": "life_task",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "minLength": 2,
            "maxLength": 240,
          },
          "details": {
            "type": "string",
            "minLength": 0,
            "maxLength": 2000,
          },
          "subtasks": {
            "type": "array",
            "maxItems": 30,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 240,
            },
          },
          "space_id": {
            "type": "string",
            "format": "uuid",
          },
          "area_key": {
            "type": "string",
            "minLength": 0,
            "maxLength": 60,
          },
        },
        "required": [
          "title",
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
        },
        "required": [
          "ok",
          "contract_version",
          "id",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action life_task as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.life_done": {
      "handler": "sandy-memory-centre",
      "action": "life_done",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
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
          "completed": {
            "type": "integer",
            "minimum": 0,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "completed",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action life_done as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.life_file": {
      "handler": "sandy-memory-centre",
      "action": "life_file",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "document_id": {
            "type": "string",
            "format": "uuid",
          },
          "space_id": {
            "type": "string",
            "format": "uuid",
          },
          "area_key": {
            "type": "string",
            "minLength": 0,
            "maxLength": 60,
          },
        },
        "required": [
          "document_id",
          "space_id",
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
          "confirmed": {
            "const": true,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "confirmed",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action life_file as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.settings": {
      "handler": "sandy-memory-centre",
      "action": "settings",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "enabled": {
            "type": "boolean",
          },
          "learning_enabled": {
            "type": "boolean",
          },
          "proactive_enabled": {
            "type": "boolean",
          },
        },
        "required": [],
        "additionalProperties": false,
        "minProperties": 1,
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
          "settings": {
            "type": "object",
            "properties": {
              "enabled": {
                "type": "boolean",
              },
              "learning_enabled": {
                "type": "boolean",
              },
              "proactive_enabled": {
                "type": "boolean",
              },
            },
            "required": [
              "enabled",
              "learning_enabled",
              "proactive_enabled",
            ],
            "additionalProperties": false,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "settings",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action settings as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.insight": {
      "handler": "sandy-memory-centre",
      "action": "insight",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
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
              "dismissed",
              "approved",
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
          "note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "note",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action insight as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.remember": {
      "handler": "sandy-memory-centre",
      "action": "remember",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string",
            "minLength": 3,
            "maxLength": 5000,
          },
          "request_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "text",
          "request_id",
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
          "stored": {
            "const": true,
          },
          "fact_id": {
            "type": "string",
            "format": "uuid",
          },
          "category": {
            "type": "string",
            "enum": [
              "pets",
              "family",
              "relationship",
              "education",
              "health",
              "career",
              "business",
              "finance",
              "travel",
              "preferences",
              "home",
              "interests",
              "personal",
            ],
          },
        },
        "required": [
          "ok",
          "contract_version",
          "stored",
          "fact_id",
          "category",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": true,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action remember as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
      "known_idempotency_dependency":
        "legacy_request_uuid_does_not_reject_changed_note_content",
    },
    "memory.get_to_know_question": {
      "handler": "sandy-memory-centre",
      "action": "get_to_know_question",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
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
          "kind": {
            "type": "string",
            "enum": [
              "expand",
              "new",
            ],
          },
          "turn": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid",
              },
              "question": {
                "type": "string",
                "minLength": 12,
                "maxLength": 240,
              },
            },
            "required": [
              "id",
              "question",
            ],
            "additionalProperties": false,
          },
          "question": {
            "type": "string",
            "minLength": 12,
            "maxLength": 240,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "kind",
        ],
        "additionalProperties": true,
        "oneOf": [
          {
            "properties": {
              "kind": {
                "const": "expand",
              },
              "turn": {
                "type": "object",
              },
            },
            "required": [
              "turn",
            ],
          },
          {
            "properties": {
              "kind": {
                "const": "new",
              },
              "question": {
                "type": "string",
                "minLength": 12,
                "maxLength": 240,
              },
            },
            "required": [
              "question",
            ],
          },
        ],
      },
      "consumes_model_resources": true,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action get_to_know_question as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.enrich_question": {
      "handler": "sandy-memory-centre",
      "action": "enrich_question",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
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
          "turn": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid",
              },
              "question": {
                "type": "string",
                "minLength": 12,
                "maxLength": 240,
              },
            },
            "required": [
              "id",
              "question",
            ],
            "additionalProperties": false,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "turn",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": true,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action enrich_question as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.enrich_skip": {
      "handler": "sandy-memory-centre",
      "action": "enrich_skip",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "turn_id": {
            "type": "string",
            "format": "uuid",
          },
          "reason": {
            "type": "string",
            "minLength": 0,
            "maxLength": 180,
          },
        },
        "required": [
          "turn_id",
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
          "already_skipped": {
            "const": true,
          },
          "skipped": {
            "const": true,
          },
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
        "anyOf": [
          {
            "properties": {
              "already_skipped": {
                "const": true,
              },
            },
            "required": [
              "already_skipped",
            ],
          },
          {
            "properties": {
              "skipped": {
                "const": true,
              },
            },
            "required": [
              "skipped",
            ],
          },
        ],
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action enrich_skip as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.enrich_answer": {
      "handler": "sandy-memory-centre",
      "action": "enrich_answer",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "turn_id": {
            "type": "string",
            "format": "uuid",
          },
          "answer": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1800,
          },
        },
        "required": [
          "turn_id",
          "answer",
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
          "fact_id": {
            "type": "string",
            "format": "uuid",
          },
        },
        "required": [
          "ok",
          "contract_version",
          "fact_id",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action enrich_answer as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.fact_correct": {
      "handler": "sandy-memory-centre",
      "action": "fact_correct",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "confirm": {
            "const": true,
          },
          "new_value": {
            "type": [
              "string",
              "null",
            ],
            "minLength": 2,
            "maxLength": 1000,
          },
        },
        "required": [
          "id",
          "confirm",
          "new_value",
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
          "note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "note",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action fact_correct as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.task_add": {
      "handler": "sandy-memory-centre",
      "action": "task_add",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "minLength": 2,
            "maxLength": 240,
          },
          "parent_id": {
            "type": [
              "string",
              "null",
            ],
            "format": "uuid",
          },
          "due_at": {
            "type": [
              "string",
              "null",
            ],
            "format": "date-time",
          },
          "description": {
            "type": "string",
            "minLength": 0,
            "maxLength": 1200,
          },
          "priority": {
            "type": "string",
            "enum": [
              "low",
              "normal",
              "high",
            ],
          },
        },
        "required": [
          "title",
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
        },
        "required": [
          "ok",
          "contract_version",
          "id",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action task_add as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.task_status": {
      "handler": "sandy-memory-centre",
      "action": "task_status",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
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
              "open",
              "in_progress",
              "done",
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
        },
        "required": [
          "ok",
          "contract_version",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action task_status as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.task_delete": {
      "handler": "sandy-memory-centre",
      "action": "task_delete",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "confirm": {
            "const": true,
          },
        },
        "required": [
          "id",
          "confirm",
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
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action task_delete as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
    },
    "memory.forget": {
      "handler": "sandy-memory-centre",
      "action": "forget",
      "authorization": "portal",
      "permission_scope": "memory:write",
      "is_mutation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
          },
          "confirm": {
            "const": true,
          },
        },
        "required": [
          "id",
          "confirm",
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
          "note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
          },
        },
        "required": [
          "ok",
          "contract_version",
          "note",
        ],
        "additionalProperties": true,
      },
      "consumes_model_resources": false,
      "requirement_ids": [
        152,
        153,
        160,
      ],
      "backend_version": 28,
      "backend_source_sha256":
        "8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace",
      "description":
        "Invoke fixed Memory Portal action forget as the confirmed independently enrolled portal user. Contract v1.0.0; this action persists audit/application state or consumes provider resources and is a mutation.",
      "forgets_indexed_copy_only": true,
    },
  };

// Canonical API/MCP correction uses the same existing database action with an
// atomic receipt. The original Memory Centre UI action remains compatible.
Object.assign(memoryOperationContracts["memory.fact_correct"], {
  input_schema: memoryCorrectionMutationContract.input_schema,
  output_schema: memoryCorrectionMutationContract.output_schema,
  description:
    "Correct or reject one own active profile fact using a genuine portal session, explicit confirmation and stable idempotency receipt; verify supersession and rejection provenance. No caller-supplied customer or identity.",
});
