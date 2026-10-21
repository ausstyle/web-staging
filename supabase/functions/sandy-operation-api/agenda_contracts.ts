// Fixed contracts reviewed against deployed Agenda v67.
export const agendaContracts: Record<string, Record<string, unknown>> = {
  "agenda.overview": {
    "handler": "sandy-agenda",
    "action": "list",
    "is_mutation": false,
    "permission_scope": "tasks:read",
    "authorization": "portal_and_agenda",
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
        "suggestions": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "attention": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "dependencies": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "companies": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "categories": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "delegations": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "participants": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "externalInvitations": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "collaborators": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "receivedDelegations": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
        "email": {
          "type": "string",
          "minLength": 1,
          "maxLength": 320,
        },
        "customer_id": {
          "type": "string",
          "format": "uuid",
        },
        "display_name": {
          "type": "string",
          "minLength": 0,
          "maxLength": 500,
        },
      },
      "required": [
        "ok",
        "contract_version",
        "tasks",
        "suggestions",
        "attention",
        "dependencies",
        "companies",
        "categories",
        "delegations",
        "participants",
        "externalInvitations",
        "collaborators",
        "receivedDelegations",
        "email",
        "customer_id",
        "display_name",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": true,
    "method": "GET",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action list with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.pins.list": {
    "handler": "sandy-agenda",
    "action": "pins-list",
    "is_mutation": false,
    "permission_scope": "tasks:read",
    "authorization": "portal_and_agenda",
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
        "pins": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
      },
      "required": [
        "ok",
        "contract_version",
        "pins",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": true,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action pins-list with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.pins.save": {
    "handler": "sandy-operation-api",
    "action": "pins-save",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "task_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
          },
          "maxItems": 100,
          "uniqueItems": true,
        },
      },
      "required": [
        "task_ids",
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
        "task_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
          },
          "maxItems": 100,
          "uniqueItems": true,
        },
        "reused": {
          "type": "boolean",
        },
      },
      "required": [
        "ok",
        "contract_version",
        "task_ids",
        "reused",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action pins-save with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
    "rpc": "sandy_api_agenda_save_pins",
  },
  "agenda.access.revoke": {
    "handler": "sandy-agenda",
    "action": "revoke-access",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "task_id": {
          "type": "string",
          "format": "uuid",
        },
        "recipient_customer_id": {
          "type": "string",
          "format": "uuid",
        },
        "invitation_id": {
          "type": "string",
          "format": "uuid",
        },
        "kind": {
          "type": "string",
          "enum": [
            "share",
            "delegation",
          ],
        },
      },
      "required": [
        "task_id",
      ],
      "additionalProperties": false,
      "oneOf": [
        {
          "properties": {
            "invitation_id": {
              "type": "string",
              "format": "uuid",
            },
          },
          "required": [
            "invitation_id",
          ],
          "not": {
            "properties": {
              "recipient_customer_id": {
                "type": "string",
                "format": "uuid",
              },
            },
            "required": [
              "recipient_customer_id",
            ],
          },
        },
        {
          "properties": {
            "recipient_customer_id": {
              "type": "string",
              "format": "uuid",
            },
            "kind": {
              "type": "string",
              "enum": [
                "share",
                "delegation",
              ],
            },
          },
          "required": [
            "recipient_customer_id",
            "kind",
          ],
          "not": {
            "properties": {
              "invitation_id": {
                "type": "string",
                "format": "uuid",
              },
            },
            "required": [
              "invitation_id",
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
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action revoke-access with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
    "argument_mapping": {
      "recipient_customer_id": "customer_id",
    },
  },
  "agenda.sharing.create": {
    "handler": "sandy-agenda",
    "action": "share-task",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "task_id": {
          "type": "string",
          "format": "uuid",
        },
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254,
        },
        "role": {
          "type": "string",
          "enum": [
            "viewer",
            "collaborator",
          ],
        },
        "scope": {
          "type": "string",
          "enum": [
            "task",
            "subtree",
          ],
        },
      },
      "required": [
        "task_id",
        "email",
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
          "maxLength": 3000,
        },
      },
      "required": [
        "ok",
        "contract_version",
        "note",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action share-task with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.delegation.create": {
    "handler": "sandy-agenda",
    "action": "delegate",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "task_id": {
          "type": "string",
          "format": "uuid",
        },
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254,
        },
        "scope": {
          "type": "string",
          "enum": [
            "task",
            "subtree",
          ],
        },
      },
      "required": [
        "task_id",
        "email",
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
          "maxLength": 3000,
        },
      },
      "required": [
        "ok",
        "contract_version",
        "note",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": true,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action delegate with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.delegation.invite": {
    "handler": "sandy-agenda",
    "action": "invite-delegate",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "task_id": {
          "type": "string",
          "format": "uuid",
        },
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254,
        },
        "scope": {
          "type": "string",
          "enum": [
            "task",
            "subtree",
          ],
        },
      },
      "required": [
        "task_id",
        "email",
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
          "maxLength": 3000,
        },
      },
      "required": [
        "ok",
        "contract_version",
        "note",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": true,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action invite-delegate with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.sharing.accept_link": {
    "handler": "sandy-agenda",
    "action": "accept-task-link",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
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
        "task_id": {
          "type": "string",
          "format": "uuid",
        },
        "accepted": {
          "const": true,
        },
      },
      "required": [
        "ok",
        "contract_version",
        "task_id",
        "accepted",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action accept-task-link with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.delegation.respond": {
    "handler": "sandy-agenda",
    "action": "delegation-response",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
        },
        "decision": {
          "type": "string",
          "enum": [
            "accepted",
            "declined",
          ],
        },
      },
      "required": [
        "id",
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
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action delegation-response with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.delegation.revoke": {
    "handler": "sandy-agenda",
    "action": "delegation-revoke",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
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
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action delegation-revoke with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.shared_tasks.create": {
    "handler": "sandy-agenda",
    "action": "shared-create",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "parent_task_id": {
          "type": "string",
          "format": "uuid",
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240,
        },
      },
      "required": [
        "parent_task_id",
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
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action shared-create with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.tasks.history": {
    "handler": "sandy-agenda",
    "action": "task-history",
    "is_mutation": false,
    "permission_scope": "tasks:read",
    "authorization": "portal_and_agenda",
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
        "entries": {
          "type": "array",
          "items": {
            "type": "object",
          },
        },
      },
      "required": [
        "ok",
        "contract_version",
        "entries",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action task-history with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.tasks.comment": {
    "handler": "sandy-agenda",
    "action": "task-comment",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 12000,
        },
      },
      "required": [
        "id",
        "text",
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
        "entry": {
          "type": "object",
        },
      },
      "required": [
        "ok",
        "contract_version",
        "entry",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action task-comment with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.shared_tasks.update": {
    "handler": "sandy-agenda",
    "action": "shared-update",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240,
        },
        "restore_original": {
          "type": "boolean",
        },
        "status": {
          "type": "string",
          "enum": [
            "todo",
            "in_progress",
            "waiting",
            "blocked",
            "completed",
          ],
        },
        "details": {
          "type": "string",
          "minLength": 0,
          "maxLength": 12000,
        },
        "priority": {
          "type": "string",
          "enum": [
            "low",
            "normal",
            "high",
            "urgent",
          ],
        },
        "due_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "position": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10000000,
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
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action shared-update with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.categories.create": {
    "handler": "sandy-agenda",
    "action": "category-create",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
        },
        "company_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
        },
        "parent_category_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
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
        "category": {
          "type": "object",
        },
      },
      "required": [
        "ok",
        "contract_version",
        "category",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": true,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action category-create with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.categories.update": {
    "handler": "sandy-agenda",
    "action": "category-update",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
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
          "maxLength": 160,
        },
        "parent_category_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
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
        "category": {
          "type": "object",
        },
      },
      "required": [
        "ok",
        "contract_version",
        "category",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": true,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action category-update with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.categories.delete": {
    "handler": "sandy-agenda",
    "action": "category-delete",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
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
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action category-delete with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.companies.create": {
    "handler": "sandy-agenda",
    "action": "company-create",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
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
        "company": {
          "type": "object",
        },
      },
      "required": [
        "ok",
        "contract_version",
        "company",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": true,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action company-create with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.tasks.create": {
    "handler": "sandy-agenda",
    "action": "create",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240,
        },
        "details": {
          "type": "string",
          "minLength": 0,
          "maxLength": 12000,
        },
        "priority": {
          "type": "string",
          "enum": [
            "low",
            "normal",
            "high",
            "urgent",
          ],
        },
        "due_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "start_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "next_review_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "waiting_on": {
          "type": [
            "string",
            "null",
          ],
          "maxLength": 400,
        },
        "company_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
        },
        "category_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
        },
        "parent_task_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
        },
        "contact_name": {
          "type": [
            "string",
            "null",
          ],
          "maxLength": 240,
        },
        "schedule_timezone": {
          "type": "string",
          "minLength": 0,
          "maxLength": 80,
        },
        "scheduled_end_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "due_time_specified": {
          "type": "boolean",
        },
        "client_request_id": {
          "type": "string",
          "pattern": "^pending-[a-f0-9-]{36}$",
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
        "interpreted": {
          "const": false,
        },
      },
      "required": [
        "ok",
        "contract_version",
        "id",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action create with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.tasks.update": {
    "handler": "sandy-agenda",
    "action": "update",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240,
        },
        "details": {
          "type": "string",
          "minLength": 0,
          "maxLength": 12000,
        },
        "priority": {
          "type": "string",
          "enum": [
            "low",
            "normal",
            "high",
            "urgent",
          ],
        },
        "due_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "start_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "next_review_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "waiting_on": {
          "type": [
            "string",
            "null",
          ],
          "maxLength": 400,
        },
        "company_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
        },
        "category_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
        },
        "parent_task_id": {
          "type": [
            "string",
            "null",
          ],
          "format": "uuid",
        },
        "contact_name": {
          "type": [
            "string",
            "null",
          ],
          "maxLength": 240,
        },
        "schedule_timezone": {
          "type": "string",
          "minLength": 0,
          "maxLength": 80,
        },
        "scheduled_end_at": {
          "type": [
            "string",
            "null",
          ],
          "format": "date-time",
        },
        "due_time_specified": {
          "type": "boolean",
        },
        "status": {
          "type": "string",
          "enum": [
            "todo",
            "in_progress",
            "waiting",
            "blocked",
            "completed",
            "cancelled",
          ],
        },
        "position": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10000000,
        },
        "archive": {
          "type": "boolean",
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
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action update with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
    "fixed": {
      "interpret": false,
    },
  },
  "agenda.tasks.interpret": {
    "handler": "sandy-agenda",
    "action": "update",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240,
        },
        "details": {
          "type": "string",
          "minLength": 0,
          "maxLength": 12000,
        },
      },
      "required": [
        "id",
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
      },
      "required": [
        "ok",
        "contract_version",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": true,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action update with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
    "fixed": {
      "interpret": true,
      "restore_original": false,
    },
  },
  "agenda.tasks.complete_tree": {
    "handler": "sandy-agenda",
    "action": "complete-tree",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
        },
        "confirm_all": {
          "const": true,
        },
      },
      "required": [
        "id",
        "confirm_all",
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
        "updated": {
          "type": "number",
        },
      },
      "required": [
        "ok",
        "contract_version",
        "updated",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action complete-tree with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.tasks.dependency": {
    "handler": "sandy-agenda",
    "action": "dependency",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "task_id": {
          "type": "string",
          "format": "uuid",
        },
        "depends_on_id": {
          "type": "string",
          "format": "uuid",
        },
        "remove": {
          "type": "boolean",
        },
      },
      "required": [
        "task_id",
        "depends_on_id",
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
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action dependency with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.tasks.archive_tree": {
    "handler": "sandy-agenda",
    "action": "archive-tree",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
        },
        "confirm_all": {
          "const": true,
        },
      },
      "required": [
        "id",
        "confirm_all",
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
        "updated": {
          "type": "number",
        },
      },
      "required": [
        "ok",
        "contract_version",
        "updated",
      ],
      "additionalProperties": true,
    },
    "accept_legacy_without_ok": false,
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action archive-tree with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
  "agenda.suggestions.decide": {
    "handler": "sandy-agenda",
    "action": "suggestion",
    "is_mutation": true,
    "permission_scope": "tasks:write",
    "authorization": "portal_and_agenda",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
        },
        "decision": {
          "type": "string",
          "enum": [
            "accept",
            "dismiss",
          ],
        },
      },
      "required": [
        "id",
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
    "method": "POST",
    "consumes_model_resources": false,
    "sends_external_communications": false,
    "requirement_ids": [
      143,
      144,
      153,
    ],
    "backend_version": 67,
    "backend_source_sha256":
      "c173bfd6cb5593f43844d48ae48c1286b3acddf394a755be15294a15dd7faa8d",
    "description":
      "Fixed existing Agenda action suggestion with actual confirmed user session, matching portal/Agenda tenant and independent owned/shared-resource checks. Contract v1.0.0; submission, persisted state and verified external outcome remain distinct.",
  },
};
