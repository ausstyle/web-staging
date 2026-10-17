// Independent conservative risk floor for autonomous product feature proposals.
// Unknown risk always requires protected review. High-risk domains cannot be
// downgraded by an AI-generated risk classification. No customer text is stored.
const sensitiveChange=/\b(?:auth(?:entication|orization|orisation)?|oauth|oidc|jwt|sso|permissions?|credentials?|passwords?|secrets?|tokens?|apikeys?|api[\s_-]?keys?|payments?|payouts?|billing|banking|fraud|encryption|decryption|private[\s_-]?keys?|security|rls|row[\s_-]?level[\s_-]?security|cross[\s_-]?tenant|cross[\s_-]?customer|customer[\s_-]?data|personal[\s_-]?data)\b/i;
export const conservativeRisk=(risk,...descriptions)=>{
 const requested=["low","medium","high"].includes(String(risk))?String(risk):"high";
 return descriptions.some(x=>sensitiveChange.test(String(x??"")))?"high":requested;
};
