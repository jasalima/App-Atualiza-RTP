import { ImageResponse } from 'next/og';

const supported=new Set([180,192,512]);

export async function GET(_request:Request,{params}:{params:Promise<{size:string}>}){
  const requested=Number((await params).size);
  if(!supported.has(requested))return new Response('Ícone não encontrado.',{status:404});
  const fontSize=Math.round(requested*.22);
  return new ImageResponse(
    <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:'#12303a'}}>
      <div style={{width:'76%',height:'76%',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',background:'#2e7a4e',border:`${Math.max(3,Math.round(requested*.018))}px solid #e9edea`,boxShadow:`inset 0 0 0 ${Math.max(2,Math.round(requested*.012))}px #174f71`}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',fontSize,fontWeight:800,letterSpacing:'-.06em',color:'#fff'}}>RTP</div>
      </div>
    </div>,
    {width:requested,height:requested,headers:{'Cache-Control':'public, max-age=31536000, immutable'}},
  );
}
