import {assertEquals,assertRejects} from "jsr:@std/assert@1";
import {listGoogleAPIs,searchGoogleMethods,describeGoogleMethod,executeGoogleMethod} from "./google-cloud-universal.ts";

const requests: Array<{url:string;method:string}>=[];
const mock:typeof fetch=async(input,init)=>{
 const url=String(input);requests.push({url,method:String(init?.method??"GET")});
 if(url.includes("/discovery/v1/apis?"))return Response.json({items:[{name:"run",version:"v2",title:"Cloud Run"}]});
 if(url.includes("/discovery/v1/apis/run/v2/rest"))return Response.json({
  rootUrl:"https://run.googleapis.com/",servicePath:"v2/",
  resources:{projects:{resources:{locations:{resources:{services:{methods:{
   get:{id:"run.projects.locations.services.get",path:"projects/{projectsId}/locations/{locationsId}/services/{servicesId}",httpMethod:"GET",parameters:{projectsId:{location:"path",required:true},locationsId:{location:"path",required:true},servicesId:{location:"path",required:true}}},
   patch:{id:"run.projects.locations.services.patch",path:"projects/{projectsId}/locations/{locationsId}/services/{servicesId}",httpMethod:"PATCH",parameters:{projectsId:{location:"path"},locationsId:{location:"path"},servicesId:{location:"path"},updateMask:{location:"query"}}}
  }}}}}}}}
 });
 return Response.json({name:"sandy-marketing",state:"READY"});
};
Deno.test("list and discover nested Cloud Run methods",async()=>{
 assertEquals((await listGoogleAPIs(mock))[0].api,"run");
 const x=await searchGoogleMethods("run","v2","services.get",mock);
 assertEquals(x[0].httpMethod,"GET");
 const m=await describeGoogleMethod("run","v2",x[0].id,mock);
 assertEquals(m.id,"run.projects.locations.services.get");
});
Deno.test("authorized read formats Google request and audits",async()=>{
 let audits=0;
 const result=await executeGoogleMethod({api:"run",version:"v2",methodId:"run.projects.locations.services.get",pathParams:{projectsId:"elaborate-haven-511518-a5",locationsId:"europe-west1",servicesId:"sandy-marketing"}},{
  token:async()=>"test-token",assertAuthorized:async()=>{},audit:async()=>{audits++}
 },mock);
 assertEquals(result.status,200);
 assertEquals(audits,1);
 assertEquals(requests.at(-1)?.url,"https://run.googleapis.com/v2/projects/elaborate-haven-511518-a5/locations/europe-west1/services/sandy-marketing");
});
Deno.test("refuses unauthorized execution",async()=>{
 await assertRejects(()=>executeGoogleMethod({api:"run",version:"v2",methodId:"run.projects.locations.services.patch",pathParams:{projectsId:"elaborate-haven-511518-a5",locationsId:"europe-west1",servicesId:"sandy-marketing"},body:{template:{}}},{
  token:async()=>"test-token",assertAuthorized:async()=>{throw Error("approval_required")},audit:async()=>{}
 },mock),Error,"approval_required");
});
Deno.test("refuses cross-project paths",async()=>{
 await assertRejects(()=>executeGoogleMethod({api:"run",version:"v2",methodId:"run.projects.locations.services.get",pathParams:{projectsId:"other-cloud-project",locationsId:"europe-west1",servicesId:"sandy-marketing"}},{
  token:async()=>"test-token",assertAuthorized:async()=>{},audit:async()=>{}
 },mock),Error,"");
});
