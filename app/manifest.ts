import type { MetadataRoute } from 'next';

export default function manifest():MetadataRoute.Manifest{
  return {
    id:'/',
    name:'RTP Inteligente · FAPTO',
    short_name:'RTP Inteligente',
    description:'Gestão e geração rastreável de Relatórios Técnicos Parciais.',
    lang:'pt-BR',
    start_url:'/?origem=aplicativo',
    scope:'/',
    display:'standalone',
    background_color:'#e9edea',
    theme_color:'#12303a',
    orientation:'any',
    categories:['business','productivity'],
    icons:[
      {src:'/pwa/192',sizes:'192x192',type:'image/png',purpose:'any'},
      {src:'/pwa/512',sizes:'512x512',type:'image/png',purpose:'any'},
      {src:'/pwa/512',sizes:'512x512',type:'image/png',purpose:'maskable'},
    ],
    shortcuts:[
      {name:'Visão geral',short_name:'Início',url:'/'},
      {name:'Relatórios',short_name:'RTPs',url:'/reports'},
    ],
  };
}
