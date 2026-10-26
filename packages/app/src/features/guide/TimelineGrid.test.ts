import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import type { Programme } from '@norstream/core';
const m=vi.hoisted(()=>({full:vi.fn(),list:vi.fn(),xml:vi.fn(),write:vi.fn(),listeners:new Set<(s:string)=>void>(),start:0,app:{currentState:'active'}}));
vi.mock('react-native',async()=>{
 const React=await import('react');
 return {Platform:{isTV:true,OS:'android'},AppState:{get currentState(){return m.app.currentState;},addEventListener:(_n:string,f:(s:string)=>void)=>{m.listeners.add(f);return{remove:()=>m.listeners.delete(f)};}},View:'View',Text:'Text',TVFocusGuideView:'TVFocusGuideView',StyleSheet:{create:(v:unknown)=>v,hairlineWidth:0.5},useTVEventHandler:()=>{},
 FlatList:React.forwardRef(function List(p:any,ref){React.useImperativeHandle(ref,()=>({scrollToIndex:vi.fn()}));return React.createElement('NativeList',p,p.data.slice(m.start,m.start+12).map((item:StoredChannel,i:number)=>React.createElement(React.Fragment,{key:item.id},p.renderItem({item,index:i+m.start}))));})};
});
vi.mock('../../sync/epgCache.js',()=>({ensureFullEpg:m.full}));
vi.mock('../../storage/programmes.js',()=>({listProgrammes:m.list,upsertProgrammes:m.write}));
vi.mock('../../sync/panelEpg.js',()=>({syncPanelEpg:m.xml}));
vi.mock('../../ui/ChannelLogo.js',()=>({ChannelLogo:()=>null}));
vi.mock('../../ui/TvPressable.js',()=>({TvPressable:'TvPressable'}));
vi.mock('../../ui/ThemeContext.js',()=>({useStyles:(make:(c:any)=>unknown)=>make({text:'#fff',textMuted:'#ccc',surface:'#111',background:'#000',accent:'#0af',danger:'#f00'})}));
import { TimelineGrid } from './TimelineGrid.js';
let tree:ReactTestRenderer|null=null;
type Props=Parameters<typeof TimelineGrid>[0];let options:Props;
const channels=Array.from({length:100},(_,i)=>({id:`panel:${i}`,sourceId:'panel',streamId:String(i),streamUrl:null,name:`Kanal ${i}`,logoUrls:[],hasArchive:true} as unknown as StoredChannel));
const programme=(id:string,title='Friskt program'):Programme=>({channelId:id,title,description:null,start:new Date('2026-10-26T09:00:00Z'),stop:new Date('2026-10-26T10:00:00Z')});
function props(extra:Partial<Props>={}):Props {const session={db:{},credsBySource:new Map([['panel',{}]]),fetchImpl:vi.fn(),access:()=>({source:{kind:'xtream'}})} as unknown as AppSession;return{session,channels,now:new Date('2026-10-26T09:15:00Z'),hasDialectFor:()=>true,onFocusChannel:vi.fn(),onFocusProgramme:vi.fn(),onOpen:vi.fn(),offsetMinutes:0,onStepTime:vi.fn(),focusFirstSignal:0,active:true,returnFocusChannelId:null,onReturnFocus:vi.fn(),...extra};}
async function mount(p=props()){options=p;await act(async()=>{tree=create(createElement(TimelineGrid,p),{createNodeMock:()=>({requestTVFocus:vi.fn()})});});await act(async()=>tree!.root.findByType('TVFocusGuideView' as any).props.onLayout({nativeEvent:{layout:{height:400}}}));}
async function update(p:Partial<Props>){options={...options,...p};await act(async()=>tree!.update(createElement(TimelineGrid,options)));}
const text=()=>tree!.root.findAllByType('Text' as any).map(n=>n.children.join('')).join(' | ');
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
async function foreground(s:string){await act(async()=>{m.app.currentState=s;for(const f of m.listeners)f(s);});}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',(f:()=>void)=>setTimeout(f,1));vi.stubGlobal('cancelAnimationFrame',clearTimeout);m.app.currentState='active';m.start=0;m.listeners.clear();m.xml.mockReset().mockImplementation(async(_db,_source,_creds,opts)=>({matched:opts.channelIds.length,programmes:opts.channelIds.length,channelIds:opts.channelIds}));m.write.mockReset().mockResolvedValue(undefined);m.full.mockReset().mockResolvedValue({fetched:1,failed:0,programmes:1,reason:null});m.list.mockReset().mockImplementation(async(_db,id:string)=>[programme(id)]);});
afterEach(async()=>{if(tree)await act(async()=>{tree!.unmount();tree=null;});expect(m.listeners.size).toBe(0);vi.unstubAllGlobals();});
it('viser ikke tidligere besoegs programkort mens frisk EPG hentes',async()=>{
 const session=props().session;await mount(props({session,channels:channels.slice(0,1)}));expect(text()).toContain('Friskt program');await act(async()=>{tree!.unmount();tree=null;});
 const wait=deferred<any>();m.full.mockReturnValue(wait.promise);m.list.mockClear();await mount(props({session,channels:channels.slice(0,1)}));expect(text()).toContain('Henter programoversigt');expect(text()).not.toContain('Friskt program');expect(m.list).not.toHaveBeenCalled();await act(async()=>wait.resolve({fetched:1,failed:0,programmes:1}));expect(text()).toContain('Friskt program');
});
it('tvinger fuld EPG per entry og laeser kun synlige 90 minutter',async()=>{
 await mount(props({channels:channels.slice(0,2)}));expect(m.full).toHaveBeenCalledTimes(2);for(const c of m.full.mock.calls){expect(c[5].force).toBe(true);expect(c[3]).toHaveLength(1);expect(c[5].shouldContinue()).toBe(true);}for(const c of m.list.mock.calls)expect(c[3].getTime()-c[2].getTime()).toBe(90*60_000);
 await update({offsetMinutes:30});expect(m.full).toHaveBeenCalledTimes(2);expect(m.list.mock.calls.at(-1)![2].getTime()).toBe(Date.parse('2026-10-26T09:30:00Z'));
});
it('henter kun 12 synlige kanaler og nye synlige raekker ved rulning',async()=>{
 await mount();expect(m.full).toHaveBeenCalledTimes(12);await act(async()=>{m.start=50;tree!.root.findByType('NativeList' as any).props.onViewableItemsChanged({viewableItems:[{index:50},{index:55}]});});expect(m.full).toHaveBeenCalledTimes(24);expect(m.full.mock.calls.slice(12).map(c=>c[3][0].id)).toEqual(channels.slice(50,62).map(c=>c.id));expect(tree!.root.findByType('NativeList' as any).props.initialNumToRender).toBe(12);
});
it('annullerer ved daekning og serialiserer frisk entry efter gammel HTTP',async()=>{
 const wait=deferred<any>();m.full.mockReturnValueOnce(wait.promise);await mount(props({channels:channels.slice(0,2)}));expect(m.full).toHaveBeenCalledTimes(1);const mayContinue=m.full.mock.calls[0]![5].shouldContinue;
 await update({active:false});expect(mayContinue()).toBe(false);await update({active:true});expect(m.full).toHaveBeenCalledTimes(1);await act(async()=>wait.resolve({fetched:1,failed:0,programmes:1}));expect(m.full).toHaveBeenCalledTimes(3);
});
it('henter igen ved appens tilbagekomst',async()=>{await mount(props({channels:channels.slice(0,1)}));expect(m.full).toHaveBeenCalledTimes(1);await foreground('background');await foreground('active');expect(m.full).toHaveBeenCalledTimes(2);});
it('ignorerer gammelt SQL efter skift af session og database',async()=>{
 const old=deferred<Programme[]>();m.list.mockReturnValueOnce(old.promise);await mount(props({channels:channels.slice(0,1)}));m.list.mockImplementation(async(_db,id:string)=>[programme(id,'Ny installation')]);await update({session:props().session});expect(text()).toContain('Ny installation');await act(async()=>old.resolve([programme(channels[0]!.id,'Gammelt sent svar')]));expect(text()).toContain('Ny installation');expect(text()).not.toContain('Gammelt sent svar');
});
it('viser sikker fejl uden gammel oversigt ved fejlet frisk kald',async()=>{m.full.mockResolvedValue({fetched:0,failed:1,programmes:0,reason:'private-url'});await mount(props({channels:channels.slice(0,1)}));expect(text()).toContain('Programoversigten kunne ikke hentes.');expect(text()).not.toContain('private-url');expect(m.list).not.toHaveBeenCalled();});
it('laeser M3U-import uden panel-HTTP',async()=>{const session=props().session;session.access=()=>({source:{kind:'m3u'}} as any);await mount(props({session,channels:[{...channels[0]!,streamUrl:'https://example.invalid/live'}]}));expect(m.full).not.toHaveBeenCalled();expect(m.list).toHaveBeenCalled();expect(text()).toContain('Friskt program');});

it('et synlighed-annulleret koekald kan hentes naar raekken bliver synlig igen',async()=>{
 const wait=deferred<any>();m.full.mockReturnValueOnce(wait.promise);await mount();
 const mayContinue=m.full.mock.calls[0]![5].shouldContinue;
 await act(async()=>{m.start=50;tree!.root.findByType('NativeList' as any).props.onViewableItemsChanged({viewableItems:[{index:50}]});});
 expect(mayContinue()).toBe(false);
 await act(async()=>{m.start=0;tree!.root.findByType('NativeList' as any).props.onViewableItemsChanged({viewableItems:[{index:0}]});});
 await act(async()=>wait.resolve({fetched:0,failed:0,programmes:0}));
 expect(m.full.mock.calls.filter(c=>c[3][0].id===channels[0]!.id)).toHaveLength(2);
 expect(text()).not.toContain('Programoversigten kunne ikke hentes.');expect(text()).toContain('Friskt program');
});

it('et sent SQL-svar fra forrige tidsvindue kan ikke tegne det nye vindue om',async()=>{
 const old=deferred<Programme[]>();m.list.mockReturnValueOnce(old.promise);await mount(props({channels:channels.slice(0,1)}));
 m.list.mockImplementation(async(_db,id:string)=>[programme(id,'Nyt tidsvindue')]);await update({offsetMinutes:30});expect(text()).toContain('Nyt tidsvindue');
 await act(async()=>old.resolve([programme(channels[0]!.id,'Gammelt tidsvindue')]));expect(text()).toContain('Nyt tidsvindue');expect(text()).not.toContain('Gammelt tidsvindue');expect(m.full).toHaveBeenCalledTimes(1);
});

it('tom API-EPG bruger én frisk XML-fil pr. kilde og entry uden at vise gamle programmer',async()=>{
 const session=props().session, wait=deferred<any>();m.full.mockResolvedValue({fetched:1,failed:0,programmes:0});m.xml.mockReturnValueOnce(wait.promise);
 m.list.mockImplementation(async(_db,id:string)=>[programme(id,'Gammel XML-cache')]);
 await mount(props({session,channels:channels.slice(0,2)}));
 expect(m.xml).toHaveBeenCalledTimes(1);expect(m.write).toHaveBeenCalledWith(session.db,[],{replaceChannelIds:channels.slice(0,2).map(c=>c.id)});
 expect(text()).not.toContain('Gammel XML-cache');expect(m.list).not.toHaveBeenCalled();
 m.list.mockImplementation(async(_db,id:string)=>[programme(id,'Frisk XML-oversigt')]);await act(async()=>wait.resolve({matched:2,programmes:2,channelIds:channels.slice(0,2).map(c=>c.id)}));
 expect(m.full).toHaveBeenCalledTimes(1);expect(text()).toContain('Frisk XML-oversigt');
 const opts=m.xml.mock.calls[0]![3];expect(opts.fresh).toBe(true);expect(opts.force).toBe(true);expect(opts.shouldContinue()).toBe(true);
 await act(async()=>{tree!.unmount();tree=null;});await mount(props({session,channels:channels.slice(0,2)}));expect(m.xml).toHaveBeenCalledTimes(2);
});
it('XML-fallback bevarer allerede API-opfriskede kanaler og omfatter kildens andre kendte kanaler',async()=>{
 m.full.mockResolvedValueOnce({fetched:1,failed:0,programmes:1}).mockResolvedValue({fetched:1,failed:0,programmes:0});await mount();
 expect(m.xml).toHaveBeenCalledTimes(1);const ids=m.xml.mock.calls[0]![3].channelIds;expect(ids).not.toContain(channels[0]!.id);expect(ids).toContain(channels[99]!.id);expect(m.full).toHaveBeenCalledTimes(2);
});
it('XML-fejl viser sikker fejl og downloader ikke filen igen i samme entry',async()=>{
 m.full.mockResolvedValue({fetched:1,failed:0,programmes:0});m.xml.mockRejectedValue(new Error('private-url'));m.list.mockResolvedValue([]);await mount(props({channels:channels.slice(0,2)}));expect(m.xml).toHaveBeenCalledTimes(1);expect(m.list).not.toHaveBeenCalled();expect(text()).toContain('Programoversigten kunne ikke hentes.');expect(text()).not.toContain('private-url');
});

it('XML uden match skjuler ikke naeste kanals fungerende API-oversigt',async()=>{
 m.full.mockResolvedValueOnce({fetched:1,failed:0,programmes:0}).mockResolvedValue({fetched:1,failed:0,programmes:1});
 m.xml.mockResolvedValue({matched:0,programmes:0,channelIds:[]});
 m.list.mockImplementation(async(_db,id:string)=>id===channels[0]!.id?[]:[programme(id,'Naeste kanal fra API')]);
 await mount(props({channels:channels.slice(0,2)}));
 expect(m.xml).toHaveBeenCalledTimes(1);expect(m.full).toHaveBeenCalledTimes(2);
 expect(m.full.mock.calls[1]![3][0].id).toBe(channels[1]!.id);expect(text()).toContain('Naeste kanal fra API');
 expect(text()).not.toContain('Programoversigten kunne ikke hentes.');
});
