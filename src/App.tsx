import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Trash2, TrendingUp, DollarSign, Download, Save, 
  RefreshCw, Search, Hash, Activity, PieChart,
  Wifi, Calculator, Filter, X, Printer, FileBarChart, Lock, ClipboardList, Upload, FileText, Pointer, AlertTriangle, CloudOff
} from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, Firestore } from 'firebase/firestore';

// --- TYPES ---
interface DeliveryChallan {
  id: string;
  dcNo: string;
  dcDate: string;
  _isSessionNew?: boolean;
}

interface Invoice {
  id: string;
  number: string;
  date: string;
  baseAmount: number;
  gst: number;
  whTax: number;
  fed: number;
  amount: number;
  note: string;
  isAOS: boolean;
  _isSessionNew?: boolean;
}

interface PurchaseOrder {
  id: string;
  poNo: string;
  outlet: string;
  poDate: string;
  poAmount: number | string;
  dcs: DeliveryChallan[];
  invoices: Invoice[];
  status: string;
  lastUpdated?: string;
}

interface PaymentRow {
  monthKey: string;
  label: string;
  run1: number;
  run2: number;
  run3: number;
  Dha: number;
  Jt: number;
  Qr: number;
  aosTotal: number;
  Total: number;
  paidRun1: number;
  paidRun2: number;
  paidRun3: number;
  [key: string]: any; 
}

// --- GLOBAL CONSTANTS ---
const ENV_APP_ID = 'payment-cycle-production'; 
const OUTLETS = ['Dha', 'Jt', 'Qr'];
const CURRENCY = 'PKR';

const EMPTY_PO_STATE: PurchaseOrder = { 
  id: '', poNo: '', outlet: 'Dha', 
  poDate: new Date().toISOString().split('T')[0], 
  poAmount: 0, dcs: [], invoices: [], status: 'Pending' 
};
const EMPTY_INV_INPUT: Invoice = { 
  id: '', number: '', date: '', baseAmount: 0, 
  gst: 0, whTax: 0, fed: 0, amount: 0, note: '', isAOS: false 
};
const EMPTY_DC_INPUT: DeliveryChallan = { id: '', dcNo: '', dcDate: '' };

const firebaseConfig = {
  apiKey: "AIzaSyDW1WYymS2rFwH1gNoWyXo0T2aaFO3wa-o",
  authDomain: "payment-cycle-9f3ab.firebaseapp.com",
  projectId: "payment-cycle-9f3ab",
  storageBucket: "payment-cycle-9f3ab.firebasestorage.app",
  messagingSenderId: "137486312691",
  appId: "1:137486312691:web:33c701df338bd0b7494386",
  measurementId: "G-NMHKHHZFM2"
};

// --- GLOBAL HELPERS ---
const generateUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
};

const formatCurrency = (amount: any) => {
    const val = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(val) || val === null || val === undefined) return `${CURRENCY} 0`;
    return `${CURRENCY} ${val.toLocaleString('en-US')}`;
};

const generateCompositeId = (outlet: string, poNo: string) => {
    if (!outlet || !poNo) return '';
    return `${outlet}_${poNo.trim().replace(/\//g, '_')}`;
};

const standardizeDate = (dateStr: string) => {
    if (!dateStr) return '';
    const cleanStr = dateStr.trim();
    if (cleanStr.includes('/')) {
        const [d, m, y] = cleanStr.split('/');
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return dateStr;
};

const formatDisplayDate = (isoDate: string) => {
    if (!isoDate || !isoDate.includes('-')) return isoDate || '';
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
};

const getPayableMonthKey = (invoiceDateStr: string) => {
    if (!invoiceDateStr) return 'unknown';
    const d = new Date(invoiceDateStr);
    if (isNaN(d.getTime())) return 'unknown';
    const payableDate = new Date(d.getFullYear(), d.getMonth() + 3, 1);
    return `${payableDate.getFullYear()}-${(payableDate.getMonth() + 1).toString().padStart(2, '0')}`;
};

const getDisplayMonth = (isoMonthKey: string) => {
    if (!isoMonthKey || !isoMonthKey.includes('-')) return 'Pending';
    const [year, month] = isoMonthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

const getPaymentBatch = (invoiceDateStr: string) => {
    if (!invoiceDateStr) return 'N/A';
    const d = new Date(invoiceDateStr);
    if (isNaN(d.getTime())) return 'N/A';
    const day = d.getDate();
    return day <= 15 ? 'Run 1' : day <= 24 ? 'Run 2' : 'Run 3';
};

const getBranchStyle = (outlet: string) => {
  switch (outlet) {
    case 'Dha': return { color: 'blue', bg: 'bg-blue-600', text: 'text-blue-600', border: 'border-blue-200' };
    case 'Jt': return { color: 'orange', bg: 'bg-orange-500', text: 'text-orange-600', border: 'border-orange-200' };
    case 'Qr': return { color: 'emerald', bg: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-200' };
    default: return { color: 'slate', bg: 'bg-slate-800', text: 'text-slate-600', border: 'border-slate-200' };
  }
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('entry');
  const [activeBranchTab, setActiveBranchTab] = useState('Dha');
  const [poData, setPoData] = useState<PurchaseOrder[]>([]);
  const [paymentData, setPaymentData] = useState<Record<string, any>>({});
  const [inquiryDates, setInquiryDates] = useState({ from: '', to: '' });
  
  const [currentPo, setCurrentPo] = useState<PurchaseOrder>(EMPTY_PO_STATE);
  const [stageDc, setStageDc] = useState<DeliveryChallan>(EMPTY_DC_INPUT);
  const [stageInv, setStageInv] = useState<Invoice>(EMPTY_INV_INPUT);
  const [editingPayment, setEditingPayment] = useState<any>({ monthKey: null, run1: 0, run2: 0, run3: 0 });
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const [db, setDb] = useState<Firestore | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentAction, setCurrentAction] = useState<'ADD' | 'UPDATE'>('ADD'); 

  // Initialize Firebase
  useEffect(() => {
    const initApp = async () => {
        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            const firestore = getFirestore(app);
            setDb(firestore);
            await signInAnonymously(auth);
            onAuthStateChanged(auth, (u) => { 
                if (u) { setUser(u); setIsLoading(false); } 
                else { setError("Authentication required."); }
            });
        } catch (e: any) {
            setError("Cloud Load Error: " + e.message);
            setIsLoading(false);
        }
    };
    initApp();
  }, []);

  // Listeners
  useEffect(() => {
    if (!db || !user) return; 
    const unsubPo = onSnapshot(collection(db, 'artifacts', ENV_APP_ID, 'public', 'data', 'purchaseOrders'), 
        (snapshot) => {
            const data = snapshot.docs.map(docSnap => {
                const d = docSnap.data() as any;
                return { 
                    id: docSnap.id, ...d, 
                    poDate: standardizeDate(d.poDate),
                    invoices: (d.invoices || []).map((inv: any) => ({ 
                        ...inv, 
                        amount: parseFloat(inv.amount) || 0,
                        baseAmount: parseFloat(inv.baseAmount) || 0
                    }))
                } as PurchaseOrder;
            });
            setPoData(data);
        }, 
        (err) => setError(`Sync Error: ${err.message}`)
    );

    const unsubPayments = onSnapshot(collection(db, 'artifacts', ENV_APP_ID, 'public', 'data', 'payments'), 
        (snapshot) => {
            const pMap: Record<string, any> = {};
            snapshot.docs.forEach((docSnap) => { pMap[docSnap.id] = docSnap.data(); });
            setPaymentData(pMap);
        }
    );

    return () => { unsubPo(); unsubPayments(); };
  }, [db, user]);

  // KPIs
  const stats = useMemo(() => {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
      let purchasing = 0, totalInv = 0, aosInv = 0, payable = 0, openPoValue = 0;

      poData.forEach((t) => {
          const poAmt = typeof t.poAmount === 'string' ? parseFloat(t.poAmount) : (t.poAmount || 0);
          if(t.poDate && t.poDate.startsWith(monthKey)) {
              const hasInv = t.invoices && t.invoices.length > 0 && t.invoices.some(i => (i.amount || 0) > 0);
              if (!hasInv) openPoValue += poAmt;
          }
          t.invoices.forEach((inv) => {
              if(!inv.date) return;
              if (inv.date.startsWith(monthKey)) {
                  purchasing += (inv.baseAmount || 0);
                  totalInv++;
                  if(inv.isAOS) aosInv++;
              }
              if (getPayableMonthKey(inv.date) === monthKey) {
                  payable += (inv.amount || 0);
              }
          });
      });
      return { purchasing, totalInv, aosInv, payable, openPoValue, aosPerc: totalInv > 0 ? Math.round((aosInv / totalInv) * 100) : 0 };
  }, [poData]);

  // Table Summaries
  const summaryData = useMemo(() => {
      const grouping: Record<string, PaymentRow> = {};
      poData.forEach((t) => {
          t.invoices.forEach((inv) => {
              if (!inv.date || !inv.amount) return;
              const monthKey = getPayableMonthKey(inv.date);
              const batch = getPaymentBatch(inv.date); 
              if (!grouping[monthKey]) {
                  grouping[monthKey] = { 
                    monthKey, label: getDisplayMonth(monthKey), 
                    run1: 0, run2: 0, run3: 0, Dha: 0, Jt: 0, Qr: 0, 
                    aosTotal: 0, Total: 0, 
                    paidRun1: paymentData[monthKey]?.run1 || 0, 
                    paidRun2: paymentData[monthKey]?.run2 || 0, 
                    paidRun3: paymentData[monthKey]?.run3 || 0 
                  };
              }
              const amt = inv.amount || 0;
              if (batch === 'Run 1') grouping[monthKey].run1 += amt;
              else if (batch === 'Run 2') grouping[monthKey].run2 += amt;
              else if (batch === 'Run 3') grouping[monthKey].run3 += amt;
              if (t.outlet === 'Dha') grouping[monthKey].Dha += amt;
              else if (t.outlet === 'Jt') grouping[monthKey].Jt += amt;
              else if (t.outlet === 'Qr') grouping[monthKey].Qr += amt;
              grouping[monthKey].Total += amt;
          });
      });
      return Object.values(grouping).sort((a,b) => a.monthKey.localeCompare(b.monthKey));
  }, [poData, paymentData]);

  const inquiryData = useMemo(() => {
    const results: Record<string, any[]> = { Dha: [], Jt: [], Qr: [] };
    const fromStr = inquiryDates.from || '1970-01-01';
    const toStr = inquiryDates.to || '2099-12-31';
    poData.forEach(po => {
        if (!po.invoices || !OUTLETS.includes(po.outlet)) return;
        po.invoices.forEach(inv => {
            if (inv.date >= fromStr && inv.date <= toStr) {
                results[po.outlet].push({ id: inv.id, number: inv.number, date: inv.date, amount: inv.amount || 0 });
            }
        });
    });
    return results;
  }, [poData, inquiryDates]);

  // Handlers
  const handlePoLookup = () => {
    const poNo = currentPo.poNo.trim();
    if (!poNo) return;
    const existing = poData.find(t => t.poNo === poNo && t.outlet === activeBranchTab);
    if (existing) {
        setCurrentPo({ ...existing });
        setCurrentAction('UPDATE');
    } else {
        setCurrentAction('ADD');
    }
  };

  const handleSave = async () => {
      if (!currentPo.poNo || !db) return;
      const docId = generateCompositeId(currentPo.outlet, currentPo.poNo);
      try {
          const poToSave = {
              ...currentPo,
              poDate: standardizeDate(currentPo.poDate),
              dcs: currentPo.dcs.map(d => ({ ...d, dcDate: standardizeDate(d.dcDate) })),
              invoices: currentPo.invoices.map(i => ({ ...i, date: standardizeDate(i.date) })),
              lastUpdated: new Date().toISOString(), 
              status: currentPo.invoices.length > 0 ? 'Invoiced' : 'Pending' 
          };
          await setDoc(doc(db, 'artifacts', ENV_APP_ID, 'public', 'data', 'purchaseOrders', docId), poToSave, { merge: true });
          setCurrentPo({ ...EMPTY_PO_STATE, outlet: activeBranchTab });
          setCurrentAction('ADD');
          setError("Record Saved!"); setTimeout(() => setError(null), 3000);
      } catch (e: any) { setError(`Save failed: ${e.message}`); }
  };

  const executeFinalDelete = async () => {
    if (!db || !currentPo.poNo) return;
    const docId = generateCompositeId(currentPo.outlet, currentPo.poNo);
    try {
      await deleteDoc(doc(db, 'artifacts', ENV_APP_ID, 'public', 'data', 'purchaseOrders', docId));
      setIsDeleteModalOpen(false);
      setCurrentPo({ ...EMPTY_PO_STATE, outlet: activeBranchTab });
      setCurrentAction('ADD');
      setError("Deleted Successfully."); setTimeout(() => setError(null), 3000);
    } catch (err: any) { setError("Error: " + err.message); }
  };

  // Auto-calc total
  useEffect(() => {
    const total = (Number(stageInv.baseAmount) || 0) + (Number(stageInv.gst) || 0) + (Number(stageInv.fed) || 0) + (Number(stageInv.whTax) || 0);
    setStageInv(prev => ({ ...prev, amount: total }));
  }, [stageInv.baseAmount, stageInv.gst, stageInv.fed, stageInv.whTax]);

  if (isLoading) return <div className="p-20 text-center font-bold text-blue-600 animate-pulse">Syncing Cloud Database...</div>;

  return (
    <div className="max-w-7xl mx-auto bg-gray-50 min-h-screen p-4 font-sans text-gray-800">
      
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4"><AlertTriangle size={32} /></div>
            <h2 className="text-xl font-bold mb-2 text-slate-900">Confirm Deletion?</h2>
            <p className="text-sm text-slate-500 mb-6">This will permanently remove PO <span className="font-bold">#{currentPo.poNo}</span> for <span className={`font-black uppercase text-${getBranchStyle(currentPo.outlet).color}-600`}>{currentPo.outlet} Branch</span>.</p>
            <div className="flex gap-3">
              <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 px-4 py-3 bg-slate-100 rounded-xl font-bold">Cancel</button>
              <button onClick={executeFinalDelete} className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-bold">Delete Now</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-slate-900 text-white p-6 rounded-t-xl shadow-lg mb-6 flex justify-between items-center gap-4">
        <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="text-green-400" /> P2P Cloud Manager</h1>
            <p className="text-[10px] text-slate-500 font-mono uppercase mt-1 flex items-center gap-2">
                {user ? <Wifi size={10} className="text-green-400" /> : <CloudOff size={10} className="text-red-400" />}
                Cloud Mode Active
            </p>
        </div>
        <button onClick={() => { setCurrentPo({ ...EMPTY_PO_STATE, outlet: activeBranchTab }); setCurrentAction('ADD'); }} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 transition-all"><RefreshCw size={14} /> New Entry</button>
      </div>

      {error && <div className={`p-3 rounded mb-4 text-xs font-semibold border-l-4 ${error.includes("Successfully") ? 'bg-green-50 text-green-800 border-green-500' : 'bg-yellow-100 text-yellow-800 border-yellow-500'}`}>{error}</div>}

      <div className="flex gap-2 mb-6 border-b border-gray-200 overflow-x-auto">
          {['entry', 'summary', 'reconcile', 'inquiry'].map((t, idx) => (
              <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2 font-bold text-xs rounded-t-lg transition-all whitespace-nowrap ${activeTab===t ? 'bg-white text-blue-600 border-t border-x shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>{idx+1}. {t.toUpperCase()}</button>
          ))}
      </div>

      {activeTab === 'entry' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-12 mb-2 flex gap-1">
                {OUTLETS.map(o => (
                    <button key={o} onClick={() => { setActiveBranchTab(o); if(currentAction==='ADD') setCurrentPo(p => ({...p, outlet: o})); }} className={`px-6 py-2 rounded-full text-xs font-bold uppercase transition-all shadow-sm ${activeBranchTab === o ? `${getBranchStyle(o).bg} text-white` : 'bg-white text-slate-400 hover:bg-slate-100'}`}>{o}</button>
                ))}
            </div>

            <div className="lg:col-span-12 grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                 <div className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-amber-500"><p className="text-[10px] font-bold text-slate-400 uppercase">Open POs</p><p className="text-lg font-black text-slate-800">{formatCurrency(stats.openPoValue)}</p></div>
                 <div className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-500"><p className="text-[10px] font-bold text-slate-400 uppercase">Purchasing</p><p className="text-lg font-black text-slate-800">{formatCurrency(stats.purchasing)}</p></div>
                 <div className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-indigo-500"><p className="text-[10px] font-bold text-slate-400 uppercase">AOS Ratio</p><p className="text-lg font-black text-slate-800">{stats.aosPerc}%</p></div>
                 <div className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-green-500"><p className="text-[10px] font-bold text-slate-400 uppercase">Total Due</p><p className="text-lg font-black text-slate-800">{formatCurrency(stats.payable)}</p></div>
            </div>
            
            <div className="lg:col-span-5 space-y-4">
                <div className={`bg-white p-5 rounded-lg shadow-sm border ${currentAction === 'UPDATE' ? `border-${getBranchStyle(activeBranchTab).color}-300` : 'border-slate-100'}`}>
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-4 flex items-center gap-2"><Hash size={14} /> Record Details ({activeBranchTab})</h3>
                    <div className="mb-4">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">PO Number</label>
                        <input type="text" value={currentPo.poNo} onChange={e => setCurrentPo({...currentPo, poNo: e.target.value})} onBlur={handlePoLookup} disabled={currentAction === 'UPDATE'} className="w-full mt-1 p-2 border rounded font-mono font-bold outline-none focus:border-blue-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase">Date</label><input type="date" value={currentPo.poDate} onChange={e => setCurrentPo({...currentPo, poDate: e.target.value})} disabled={currentAction === 'UPDATE'} className="w-full p-2 mt-1 border rounded text-sm" /></div>
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase">Amount (Est.)</label><input type="number" value={currentPo.poAmount} onChange={e => setCurrentPo({...currentPo, poAmount: parseFloat(e.target.value) || 0})} disabled={currentAction === 'UPDATE'} className="w-full p-2 mt-1 border rounded text-sm font-bold text-amber-700" /></div>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-lg shadow-sm border border-orange-100">
                    <h3 className="text-[10px] font-bold text-orange-600 uppercase mb-3">Delivery Challans</h3>
                    <div className="flex gap-2 mb-3 items-end bg-orange-50 p-2 rounded">
                        <div className="flex-1"><label className="text-[9px] font-bold text-gray-400 uppercase">DC #</label><input type="text" value={stageDc.dcNo} onChange={e => setStageDc({...stageDc, dcNo: e.target.value})} className="w-full p-1 border rounded text-xs outline-none" /></div>
                        <div className="flex-1"><label className="text-[9px] font-bold text-gray-400 uppercase">Date</label><input type="date" value={stageDc.dcDate} onChange={e => setStageDc({...stageDc, dcDate: e.target.value})} className="w-full p-1 border rounded text-xs outline-none" /></div>
                        <button onClick={() => { if(!stageDc.dcNo) return; setCurrentPo({...currentPo, dcs: [...currentPo.dcs, { ...stageDc, id: generateUID(), _isSessionNew: true }]}); setStageDc(EMPTY_DC_INPUT); }} className="bg-orange-500 text-white p-1.5 rounded"><Plus size={16} /></button>
                    </div>
                    <div className="space-y-1">
                        {currentPo.dcs.map((dc, idx) => (
                            <div key={dc.id || idx} className="flex justify-between items-center text-xs p-1.5 bg-gray-50 rounded border-l-2 border-orange-300">
                                <span>{dc.dcNo} | {formatDisplayDate(dc.dcDate)}</span>
                                {(currentAction === 'ADD' || dc._isSessionNew) && (<button onClick={() => setCurrentPo({...currentPo, dcs: currentPo.dcs.filter(d=>d.id !== dc.id)})} className="text-red-400"><Trash2 size={12} /></button>)}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-white p-5 rounded-lg shadow-sm border border-green-100">
                    <h3 className="text-[10px] font-bold text-green-700 uppercase mb-3">Invoice Details</h3>
                    <div className="bg-green-50 p-3 rounded mb-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div><label className="text-[9px] font-bold text-gray-400 uppercase">Inv #</label><input type="text" value={stageInv.number} onChange={e => setStageInv({...stageInv, number: e.target.value})} className="w-full p-1 border rounded text-xs" /></div>
                            <div><label className="text-[9px] font-bold text-gray-400 uppercase">Date</label><input type="date" value={stageInv.date} onChange={e => setStageInv({...stageInv, date: e.target.value})} className="w-full p-1 border rounded text-xs" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div><label className="text-[9px] font-bold text-blue-600 uppercase">Base Amt</label><input type="number" value={stageInv.baseAmount} onChange={e => setStageInv({...stageInv, baseAmount: parseFloat(e.target.value) || 0})} className="w-full p-1 border border-blue-200 rounded text-xs font-bold" /></div>
                            <div><label className="text-[9px] font-bold text-gray-400 uppercase">G.S.T</label><input type="number" value={stageInv.gst} onChange={e => setStageInv({...stageInv, gst: parseFloat(e.target.value) || 0})} className="w-full p-1 border rounded text-xs" /></div>
                        </div>
                        <div className="flex items-center justify-between border-t border-green-200 pt-2">
                            <div className="text-xs font-black text-green-800">{formatCurrency(stageInv.amount)}</div>
                            <div className="flex items-center gap-2">
                                <label className="text-[9px] flex items-center text-slate-400"><input type="checkbox" checked={stageInv.isAOS} onChange={e => setStageInv({...stageInv, isAOS: e.target.checked})} className="mr-1" /> AOS</label>
                                <button onClick={() => { if(!stageInv.baseAmount) return; setCurrentPo({...currentPo, invoices: [...currentPo.invoices, {...stageInv, id: generateUID(), _isSessionNew: true}]}); setStageInv(EMPTY_INV_INPUT); }} className="bg-green-600 text-white px-3 py-1 rounded text-xs font-bold">+ Add</button>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1">
                        {currentPo.invoices.map((inv, idx) => (
                            <div key={inv.id || idx} className="flex justify-between items-center text-xs p-1.5 bg-gray-50 rounded border-l-2 border-green-300">
                                <div><div className="font-bold text-green-800">{formatCurrency(inv.amount)}</div><div className="text-[9px] text-gray-400">#{inv.number}</div></div>
                                {(currentAction === 'ADD' || inv._isSessionNew) && (<button onClick={() => setCurrentPo({...currentPo, invoices: currentPo.invoices.filter(i=>i.id !== inv.id)})} className="text-red-400"><Trash2 size={12} /></button>)}
                            </div>
                        ))}
                    </div>
                </div>
                
                <div className="flex gap-3">
                   <button onClick={handleSave} className="flex-[2] bg-slate-800 text-white py-3 rounded-xl shadow-lg font-bold transition-all hover:bg-slate-700 flex items-center justify-center gap-2"><Save size={18} /> Save Records</button>
                   {currentAction === 'UPDATE' && (
                     <button onClick={() => setIsDeleteModalOpen(true)} className="flex-1 bg-white border-2 border-red-100 text-red-600 py-3 rounded-xl font-bold hover:bg-red-50 flex items-center justify-center gap-2"><Trash2 size={18} /> Delete</button>
                   )}
                </div>
            </div>

            <div className="lg:col-span-7 overflow-x-auto">
                <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                    <div className="bg-gray-50 p-2 border-b text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                        <Pointer size={12} className="text-blue-500" /> Click to Edit Records
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-gray-100 text-[10px] uppercase text-gray-500 border-b"><tr><th className="p-3 text-left">PO #</th><th className="p-3 text-left">Date</th><th className="p-3 text-left">Stats</th></tr></thead>
                        <tbody className="divide-y">
                            {poData.filter(t => t.outlet === activeBranchTab).sort((a,b) => b.poNo.localeCompare(a.poNo)).map((t, idx) => (
                                <tr key={t.id || idx} onClick={() => loadPoForEditing(t)} className="hover:bg-blue-50 transition cursor-pointer">
                                    <td className="p-3 font-mono font-bold text-blue-600 flex items-center gap-2">{t.poNo} <Search size={10} className="text-slate-300" /></td>
                                    <td className="p-3 text-xs text-slate-400">{formatDisplayDate(t.poDate)}</td>
                                    <td className="p-3 text-xs text-green-600 font-bold">{t.invoices.length} Inv ({formatCurrency(t.invoices.reduce((s,i)=>s+(i.amount || 0), 0))})</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}

      {activeTab === 'summary' && (
        <div className="bg-white p-6 rounded-lg shadow-sm border overflow-x-auto">
            <h2 className="text-lg font-bold mb-4 text-slate-800">HO Outflow Projection</h2>
            <table className="w-full text-sm border-collapse whitespace-nowrap">
                <thead><tr className="bg-slate-800 text-white text-[10px] uppercase">
                    <th className="p-3 text-left">Month</th>
                    <th className="p-3 text-right">Run 1</th><th className="p-3 text-right">Run 2</th><th className="p-3 text-right">Run 3</th>
                    {OUTLETS.map(o => <th key={o} className="p-3 text-right">{o}</th>)}
                    <th className="p-3 text-right bg-green-700">Total</th>
                </tr></thead>
                <tbody>{summaryData.map((row, idx) => (<tr key={row.monthKey || idx} className="border-b hover:bg-gray-50"><td className="p-3 font-bold">{row.label}</td><td className="p-3 text-right font-mono text-slate-500">{formatCurrency(row.run1)}</td><td className="p-3 text-right font-mono text-slate-500">{formatCurrency(row.run2)}</td><td className="p-3 text-right font-mono text-slate-500">{formatCurrency(row.run3)}</td>{OUTLETS.map(o => <td key={o} className="p-3 text-right font-mono text-gray-400">{formatCurrency(row[o])}</td>)}<td className="p-3 text-right font-bold text-green-800 bg-green-50">{formatCurrency(row.Total)}</td></tr>))}</tbody>
            </table>
        </div>
      )}

      {activeTab === 'reconcile' && (
        <div className="bg-white p-6 rounded-lg shadow-sm border overflow-x-auto">
            <h2 className="text-lg font-bold mb-4 text-slate-800 tracking-tight">Payment Reconciliation</h2>
            <table className="w-full text-sm border-collapse whitespace-nowrap">
                <thead><tr className="bg-slate-800 text-white text-[10px] uppercase">
                    <th className="p-3 text-left">Month</th><th className="p-3 text-right">Accrued</th>
                    <th className="p-3 text-right">Paid (All Runs)</th>
                    <th className="p-3 text-right bg-red-900 text-white">Balance</th><th className="p-3 text-center">Action</th>
                </tr></thead>
                <tbody>{summaryData.map((row, idx) => {
                    const totalPaid = (row.paidRun1 || 0) + (row.paidRun2 || 0) + (row.paidRun3 || 0);
                    const bal = row.Total - totalPaid;
                    const isEditing = editingPayment.monthKey === row.monthKey;
                    return (
                        <tr key={row.monthKey || idx} className="border-b hover:bg-gray-50">
                            <td className="p-3 font-bold">{row.label}</td><td className="p-3 text-right font-bold text-emerald-800 font-mono">{formatCurrency(row.Total)}</td>
                            <td className="p-3 text-right font-mono">
                                {isEditing ? (
                                    <div className="flex flex-col gap-1">
                                        <input type="number" placeholder="Run 1" value={editingPayment.run1} onChange={e => setEditingPayment({...editingPayment, run1: parseFloat(e.target.value) || 0})} className="border rounded p-1 text-right text-xs" />
                                        <input type="number" placeholder="Run 2" value={editingPayment.run2} onChange={e => setEditingPayment({...editingPayment, run2: parseFloat(e.target.value) || 0})} className="border rounded p-1 text-right text-xs" />
                                        <input type="number" placeholder="Run 3" value={editingPayment.run3} onChange={e => setEditingPayment({...editingPayment, run3: parseFloat(e.target.value) || 0})} className="border rounded p-1 text-right text-xs" />
                                    </div>
                                ) : formatCurrency(totalPaid)}
                            </td>
                            <td className={`p-3 text-right font-bold font-mono ${bal > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(bal)}</td>
                            <td className="p-3 text-center">
                                {isEditing ? (
                                  <div className="flex gap-1 justify-center">
                                    <button onClick={async () => { if(!db) return; await setDoc(doc(db, 'artifacts', ENV_APP_ID, 'public', 'data', 'payments', row.monthKey), { run1: editingPayment.run1, run2: editingPayment.run2, run3: editingPayment.run3 }, { merge: true }); setEditingPayment({monthKey:null, run1:0, run2:0, run3:0}); }} className="bg-green-600 text-white px-2 py-1 rounded text-xs">Save</button>
                                    <button onClick={()=>setEditingPayment({monthKey:null, run1:0, run2:0, run3:0})} className="bg-gray-400 text-white px-2 py-1 rounded text-xs">X</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setEditingPayment({monthKey: row.monthKey, run1: row.paidRun1, run2: row.paidRun2, run3: row.paidRun3 })} className="bg-slate-700 text-white px-3 py-1 rounded text-xs">Edit</button>
                                )}
                            </td>
                        </tr>
                    );
                })}</tbody>
            </table>
        </div>
      )}

      {activeTab === 'inquiry' && (
        <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 border-b pb-4">
                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800"><ClipboardList className="text-blue-600" /> Invoice Period Inquiry</h2>
                <div className="flex items-center gap-2 bg-blue-50 p-2 rounded-lg">
                    <input type="date" value={inquiryDates.from} onChange={e => setInquiryDates({...inquiryDates, from: e.target.value})} className="bg-transparent text-sm font-semibold outline-none" />
                    <span className="text-slate-400">→</span>
                    <input type="date" value={inquiryDates.to} onChange={e => setInquiryDates({...inquiryDates, to: e.target.value})} className="bg-transparent text-sm font-semibold outline-none" />
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {OUTLETS.map(outlet => {
                    const branchList = inquiryData[outlet] || [];
                    const branchTotal = branchList.reduce((sum, item) => sum + (item.amount || 0), 0);
                    return (
                        <div key={outlet} className="flex flex-col border rounded shadow-sm overflow-hidden">
                            <div className={`p-2 font-bold text-center uppercase text-[10px] ${outlet === 'Dha' ? 'bg-slate-800 text-white' : outlet === 'Jt' ? 'bg-blue-700 text-white' : 'bg-emerald-700 text-white'}`}>{outlet}</div>
                            <table className="w-full text-[11px]">
                                <thead className="bg-gray-50 border-b"><tr><th className="p-2 border-r">Inv No.</th><th className="p-2 text-right">Payable</th></tr></thead>
                                <tbody className="divide-y">{branchList.map((item, idx) => (<tr key={item.id || idx} className="hover:bg-gray-50"><td className="p-2 border-r font-mono font-bold text-slate-700">{item.number || '---'}</td><td className="p-2 text-right font-mono text-slate-600">{formatCurrency(item.amount)}</td></tr>))}</tbody>
                                <tfoot className="bg-gray-50 font-bold border-t-2"><tr><td className="p-2 text-right uppercase text-[9px]">Total:</td><td className="p-2 text-right font-mono">{formatCurrency(branchTotal)}</td></tr></tfoot>
                            </table>
                        </div>
                    );
                })}
            </div>
            <div className="bg-slate-900 text-white p-5 rounded-xl flex justify-between items-center border-t-4 border-blue-500">
                <div className="flex items-center gap-3"><Calculator className="text-blue-400" /><p className="text-xs font-bold uppercase">Grand Total</p></div>
                <div className="text-2xl font-black font-mono tracking-tighter">{inquiryGrandTotalStr}</div>
            </div>
        </div>
      )}
      
      <div className="fixed bottom-0 left-0 w-full bg-slate-800 text-white text-[10px] p-1 px-4 flex justify-between items-center z-50">
          <div className="flex gap-4"><span className="flex items-center gap-1 text-green-400 font-bold"><Wifi size={10} /> Active</span><span>Records: {poData.length}</span></div><div className="text-slate-500 font-mono">Ledger: {ENV_APP_ID.substring(0,8)}...</div>
      </div>
    </div>
  );
};

export default App;