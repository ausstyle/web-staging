import json,struct,unittest
from read_edge_originals import whatsapp_original_sources
from release_web_canary import Blocked

def archive(name='sandy-whatsapp-webhook/index.ts',mapping=None):
    raw=name.encode();source=b'compiled JavaScript';maps=json.dumps(mapping if mapping is not None else {'sources':[name],'sourcesContent':['original TypeScript']}).encode()
    header=struct.pack('>I',len(raw))+raw+b'\0'+struct.pack('>IIII',0,len(source),0,len(maps))+b'\0'
    section=lambda b:struct.pack('>I',len(b))+b
    return b'ESZIP2.3'+section(bytes([0,0,1,0]))+section(header)+section(b'')+section(source)+section(maps)
class Tests(unittest.TestCase):
    def test_both_deployed_naming_formats_recover_original_not_compiled_source(self):
        expected={'sandy-whatsapp-webhook/index.ts':b'original TypeScript'}
        self.assertEqual(whatsapp_original_sources(archive()),expected)
        self.assertEqual(whatsapp_original_sources(archive('source/sandy-whatsapp-webhook/index.ts')),expected)
    def test_ambiguous_maps_missing_source_and_path_escape_never_certify_originals(self):
        for name,mapping in [('sandy-whatsapp-webhook/index.ts',{'sources':['foreign'],'sourcesContent':['x']}),('sandy-whatsapp-webhook/index.ts',{'sources':['sandy-whatsapp-webhook/index.ts'],'sourcesContent':[None]}),('sandy-whatsapp-webhook/../../index.ts',None)]:
            with self.assertRaises(Blocked):whatsapp_original_sources(archive(name,mapping))
        with self.assertRaises(Blocked):whatsapp_original_sources(archive()[:-1])
if __name__=='__main__':unittest.main()
