#!/usr/bin/env python3
"""Include the independently inspected live r49/V2-r3 master-catalogue addition.
This is additive preservation of concurrent work, not a new capability claim.
"""
import build_version_awareness as build
import build_version_awareness_compared as compared

previous = build.preserved_live_source

def current_live_source(source):
    source = previous(source)
    source = build.one(source,
        'const [caps,integrations,moduleRegistry]=await Promise.all([',
        'const [caps,integrations,moduleRegistry,masterRegistry]=await Promise.all([')
    source = build.one(source,
        'db.from("sandy_module_status").select("module_key,module_group,deployed_version,deployment_state,operational_status,remaining_steps,evidence,last_tested_at,observed_at").limit(250)',
        'db.from("sandy_module_status").select("module_key,module_group,deployed_version,deployment_state,operational_status,remaining_steps,evidence,last_tested_at,observed_at").limit(250),\n db.from("sandy_master_modules").select("module_key,module_name,description,component_patterns,sort_order,acceptance_requirements").order("sort_order")')
    source = build.one(source,
        'module_status_source:"sandy_module_status",modules:',
        'module_status_source:"sandy_module_status",master_modules:masterRegistry.error?[]:masterRegistry.data,modules:')
    return source

build.preserved_live_source = current_live_source
if __name__ == '__main__':
    compared.main()
