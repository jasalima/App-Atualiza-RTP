export type User={id:string;name:string;email:string;role:'admin'|'coordinator'|'scholar';projectId:string|null;scholarId?:string|null};
export type Project={id:string;title:string;executing_institution:string;support_foundation:string;coordinator:string;starts_on:string;ends_on:string;city:string;status:string};
export type Scholar={id:string;project_id:string;full_name:string;role_area:string;scholarship_type:string;starts_on:string;ends_on:string;status:string;has_plan?:boolean;report_count?:number};
export type PlanItem={id:string;item_type:string;title:string;description:string;starts_on?:string;ends_on?:string};
export type Report={id:string;project_id:string;scholar_id:string;scholar_name:string;number:string;period_start:string;period_end:string;issued_on:string;status:string;content?:ReportContent;validations?:Validation[];versions?:any[]};
export type ReportContent={heading:{foundation:string;form:string;title:string;project:string;scholar:string;scholarshipPeriod:string;number:string};sections:{results:string;comparison:string;additional:string};closing:{placeAndDate:string;scholar:string;role:string};pending:Array<{activity:string;reason:string}>};
export type Validation={id?:string;severity:'critical'|'attention'|'suggestion';code:string;message:string;location:string;resolved_at?:string|null};
