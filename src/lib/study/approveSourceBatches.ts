export function approvalErrorMessage(error:unknown):string {
 const e=error as {code?:string;message?:string};
 const message=e?.message||'לא התקבלה תשובה תקינה מהשרת';
 return `${e?.code?`[${e.code}] `:''}${message}. שאלות שכבר אושרו נשמרו; אפשר להמשיך את הפעולה.`;
}
export async function approveSourceBatches(call:()=>Promise<{data:unknown;error:unknown}>,onProgress:(count:number)=>void,stop:()=>boolean,maxBatches=10000){
 let total=0;
 for(let batch=0;batch<maxBatches;batch++){
  if(stop())return {total,completed:false};
  const result=await call();if(result.error)throw result.error;
  const count=Number(result.data);if(!Number.isInteger(count)||count<0||count>100)throw new Error('תשובת ספירה לא תקינה מהשרת');
  total+=count;onProgress(total);
  if(count===0)return {total,completed:true};
 }
 throw new Error('התקבלה כמות גדולה מהצפוי; יש לרענן לפני המשך');
}
