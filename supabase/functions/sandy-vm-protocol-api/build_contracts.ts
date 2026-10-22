import {protocolContracts} from './contracts.ts';
await Deno.writeTextFile(new URL('./contracts.json',import.meta.url),JSON.stringify(Object.values(protocolContracts),null,2)+'\n');
console.log(JSON.stringify({operations:Object.keys(protocolContracts).length,closed:true,verified:false}));
