"""Offline SQL emitted by the real executor for isolated PostgreSQL tests."""
import json
from unittest.mock import patch
import release_hosting_read as x

def generate(rows,prior,rollback=False):
    class Capture:
        def sql(self,query,read_only=False):
            if not read_only:self.query=query
    r=Capture();expected='candidate' if rollback else 'before';after='before' if rollback else 'candidate'
    with patch.object(x,'contracts',side_effect=[rows,[]]),patch.object(x,'contract_state',side_effect=[expected,after]):
        x.mutate_contracts(r,{},'11111111-1111-4111-8111-111111111111',prior,rollback)
    return r.query
if __name__=='__main__':
    import sys
    data=json.load(sys.stdin)
    if data.get('kind')=='owner':
        class Capture:
            def sql(self,q,read_only=False):self.query=q;return [{'admitted':True}]
        r=Capture();x.owner(r,'11111111-1111-4111-8111-111111111111');print(json.dumps({'query':r.query,'source':x.SOURCE,'manifest':x.PIN,'executor':x.executor_pin(),'targets':[*x.TARGETS,x.MIGRATION]}))
    else:print(generate(data['rows'],data['prior'],data.get('rollback',False)))
