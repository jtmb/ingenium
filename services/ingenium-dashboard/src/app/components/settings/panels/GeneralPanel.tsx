"use client";
import {useEffect,useRef,useState} from 'react';
import {api,type InstallationRetentionPreference} from '../../../../lib/api';
import {useOptionalAuth} from '../../../../lib/AuthContext';
import {useTheme} from '../../ThemeProvider';
import ChatDefaults from './ChatDefaults';
import SettingRow from '../SettingRow';
import Select from '../../Select';

/** Installation preferences have no selected workspace/project dependency. */
export default function GeneralPanel(){
 const {theme,setTheme}=useTheme(),auth=useOptionalAuth();
 const identityKey=JSON.stringify([auth?.user.id??null,auth?.user.status??null,auth?.session.id??null,auth?.installationAdmin??false]);
 return <div>
  <SettingRow label="Theme" description="Select light, dark, or system theme" controlId="general-theme">
   <Select id="general-theme" value={theme} onChange={e=>setTheme(e.target.value as 'system'|'light'|'dark')} className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer">
    <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
   </Select>
  </SettingRow>
  <ChatDefaults/>
  <ArchiveRetention key={identityKey}/>
 </div>;
}
function canonicalDays(value:string|null){return value!==null&&/^[1-9][0-9]{0,2}$/.test(value)&&Number(value)<=365?value:''}
function ArchiveRetention(){
 const [preference,setPreference]=useState<InstallationRetentionPreference|null>(null),[display,setDisplay]=useState('');
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState('');
 const epoch=useRef(0),writing=useRef(false);
 const load=async()=>{
  const request=++epoch.current;setLoading(true);setPreference(null);setError('');
  try{const r=await api.installationPreferences.getArchiveRetention();if(request!==epoch.current)return;setPreference(r.data);setDisplay(canonicalDays(r.data.value));}
  catch(failure){if(request===epoch.current)setError(failure instanceof Error?failure.message:'Unable to load archive retention');}
  finally{if(request===epoch.current)setLoading(false);}
 };
 useEffect(()=>{void load();return()=>{epoch.current++}},[]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),3000);return()=>clearTimeout(timer)},[toast]);
 const save=async(value:string)=>{
  if(!preference||writing.current)return;writing.current=true;
  const request=++epoch.current,original=preference;setError('');setToast('');setDisplay(value);setSaving(true);
  try{
   const result=await api.installationPreferences.setArchiveRetention({operationId:crypto.randomUUID(),expectedRevision:original.revision,expectedValueHash:original.valueHash,value});
   if(request!==epoch.current)return;setPreference(result.data);setDisplay(canonicalDays(result.data.value));
   setToast(result.data.value===value?'Saved ✓':'Current installation value loaded');
  }catch(failure){if(request===epoch.current){setDisplay(canonicalDays(original.value));setError(failure instanceof Error?failure.message:'Archive retention could not be saved');}}
  finally{writing.current=false;if(request===epoch.current)setSaving(false);}
 };
 return <>
  <SettingRow label="Archive retention" description="Days before archived projects are purged (1–365)" controlId="general-archive-retention">
   {loading?<span role="status" className="text-xs text-[var(--color-text-muted)]">Loading...</span>:preference?<div className="flex items-center gap-2">
    <input id="general-archive-retention" type="number" min={1} max={365} value={display} disabled={saving}
     onChange={e=>{const value=e.target.value;if(!/^[1-9][0-9]{0,2}$/.test(value)||Number(value)>365){setError('Enter a whole number from 1 to 365.');return}void save(value)}}
     aria-invalid={Boolean(error)} aria-describedby={error?'archive-retention-error':undefined}
     className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-20 text-[var(--color-text-primary)]" placeholder="Days"/>
    <span className="text-xs text-[var(--color-text-muted)]">days</span>{saving&&<span role="status" className="text-xs text-[var(--color-text-muted)]">Saving...</span>}
   </div>:<span className="text-xs text-[var(--color-error-text)]">Archive retention is unavailable.</span>}
  </SettingRow>
  {error&&<div className="px-6 -mt-2 mb-3"><p id="archive-retention-error" role="alert" className="text-xs text-[var(--color-error-text)]">{error}</p><button type="button" disabled={saving||loading} onClick={()=>{void load()}} className="mt-2 rounded border border-[var(--color-border)] px-3 py-1 text-xs">Reload archive retention</button></div>}
  {toast&&<div role="status" className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 text-sm">{toast}</div>}
 </>;
}