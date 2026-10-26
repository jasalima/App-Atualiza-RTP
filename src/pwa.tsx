'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, Monitor, Smartphone } from 'lucide-react';
import { Drawer, Notice } from './ui';

type InstallChoice={outcome:'accepted'|'dismissed';platform:string};
type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<InstallChoice>};
type Platform='ios'|'android'|'windows'|'mac'|'other';
type PwaState={installed:boolean;install:()=>Promise<void>;showHelp:()=>void};

const PwaContext=createContext<PwaState>({installed:false,install:async()=>{},showHelp:()=>{}});

function platformOf():Platform{
  const agent=navigator.userAgent;
  if(/iPad|iPhone|iPod/.test(agent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))return 'ios';
  if(/Android/i.test(agent))return 'android';
  if(/Windows/i.test(agent))return 'windows';
  if(/Macintosh|Mac OS X/i.test(agent))return 'mac';
  return 'other';
}

export function PwaProvider({children}:{children:ReactNode}){
  const [prompt,setPrompt]=useState<InstallEvent|null>(null),[help,setHelp]=useState(false),[installed,setInstalled]=useState(false);
  const [platform,setPlatform]=useState<Platform>('other');
  useEffect(()=>{
    setPlatform(platformOf());
    setInstalled(window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone));
    if('serviceWorker'in navigator)void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>undefined);
    const before=(event:Event)=>{event.preventDefault();setPrompt(event as InstallEvent);};
    const done=()=>{setInstalled(true);setPrompt(null);setHelp(false);};
    window.addEventListener('beforeinstallprompt',before);
    window.addEventListener('appinstalled',done);
    return()=>{window.removeEventListener('beforeinstallprompt',before);window.removeEventListener('appinstalled',done);};
  },[]);
  const value=useMemo<PwaState>(()=>({
    installed,
    showHelp:()=>setHelp(true),
    install:async()=>{
      if(!prompt){setHelp(true);return;}
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice.outcome==='accepted'){setInstalled(true);setPrompt(null);}
      else setHelp(true);
    },
  }),[installed,prompt]);
  return <PwaContext.Provider value={value}>{children}<InstallHelp open={help} platform={platform} onClose={()=>setHelp(false)}/></PwaContext.Provider>;
}

export function InstallAppButton({className=''}:{className?:string}){
  const {installed,install}=useContext(PwaContext);
  if(installed)return null;
  return <button type="button" className={className} onClick={()=>void install()}><Download/>Instalar aplicativo</button>;
}

const instructions:Record<Platform,{title:string;steps:string[]}>= {
  ios:{title:'iPhone ou iPad',steps:['Abra esta página no Safari.','Toque em Compartilhar.','Escolha “Adicionar à Tela de Início”, ative “Abrir como App” e toque em Adicionar.']},
  android:{title:'Android',steps:['Abra esta página no Chrome.','Toque no menu ⋮.','Escolha “Instalar app” ou “Adicionar à tela inicial” e confirme.']},
  windows:{title:'Windows',steps:['Abra esta página no Microsoft Edge ou Chrome.','Clique no ícone de instalação na barra de endereço.','Se ele não aparecer, no Edge use … > Mais ferramentas > Aplicativos > Instalar este site como um aplicativo.']},
  mac:{title:'macOS',steps:['No Chrome, clique no ícone de instalação na barra de endereço.','No Safari, use Arquivo > Adicionar ao Dock.','Confirme o nome e conclua a instalação.']},
  other:{title:'Linux ou ChromeOS',steps:['Abra esta página no Chrome.','Clique no ícone de instalação na barra de endereço ou use o menu ⋮.','Escolha “Instalar página como app” e confirme.']},
};

function InstallHelp({open,platform,onClose}:{open:boolean;platform:Platform;onClose:()=>void}){
  const detected=instructions[platform];
  const remaining=(Object.entries(instructions) as Array<[Platform,(typeof instructions)[Platform]]>).filter(([key])=>key!==platform);
  return <Drawer open={open} title="Instalar RTP Inteligente" description="Use como aplicativo, com ícone próprio e janela sem a barra do navegador." onClose={onClose}>
    <div className="stack install-help">
      <Notice tone="info" title={`Instruções para ${detected.title}`}>O acesso continua protegido por login e requer internet para consultar ou alterar dados.</Notice>
      <InstallSteps platform={platform} item={detected}/>
      <details><summary>Instruções para outros dispositivos</summary><div className="install-platforms">{remaining.map(([key,item])=><InstallSteps key={key} platform={key} item={item}/>)}</div></details>
      <button className="btn btn-primary btn-block" onClick={onClose}>Entendi</button>
    </div>
  </Drawer>;
}

function InstallSteps({platform,item}:{platform:Platform;item:(typeof instructions)[Platform]}){
  const Icon=platform==='ios'||platform==='android'?Smartphone:Monitor;
  return <section className="install-steps"><h3><Icon/>{item.title}</h3><ol>{item.steps.map((step,index)=><li key={step}><span>{index+1}</span><p>{step}</p></li>)}</ol></section>;
}
