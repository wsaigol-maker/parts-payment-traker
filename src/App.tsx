import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Trash2, TrendingUp, DollarSign, Download, Save, 
  RefreshCw, Users, FileText, CheckCircle, Search, 
  Hash, Calendar, MapPin, Activity, PieChart,
  Wifi, Calculator, Database, Filter, X, Printer, FileBarChart, Lock, ClipboardList, Upload
} from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, query, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

// --- DYNAMIC CONFIGURATION ---
const ENV_APP_ID = 'payment-cycle-production'; 

const firebaseConfig = {
  apiKey: "AIzaSyDW1WYymS2rFwH1gNoWyXo0T2aaFO3wa-o",
  authDomain: "payment-cycle-9f3ab.firebaseapp.com",
  projectId: "payment-cycle-9f3ab",
  storageBucket: "payment-cycle-9f3ab.firebasestorage.app",
  messagingSenderId: "137486312691",
  appId: "1:137486312691:web:33c701df338bd0b7494386",
  measurementId: "G-NMHKHHZFM2"
};

// Constants
const OUTLETS = ['Dha', 'Jt', 'Qr'];
const CURRENCY = 'PKR';

const formatCurrency = (amount: any) => {
    const val = parseFloat(amount);
    if (isNaN(val)) return `${CURRENCY} 0`;
    return `${CURRENCY} ${val.toLocaleString('en-US')}`;
};

// --- INITIAL STATES ---
const EMPTY_PO_STATE = {
    poNo: '', 
    outlet: 'Dha', 
    poDate: new Date().toISOString().split('T')[0], 
    dcs: [] as any[],      
    invoices: [] as any[], 
    poAmount: '' 
};

const EMPTY_INV_INPUT = { 
    number: '', 
    date: '', 
    baseAmount: '', 
    gst: '0', 
    whTax: '0', 
    fed: '0', 
    grossTotal: 0,
    amount: 0,      
    note: '', 
    isAOS: false 
};

const App = () => {
  const [activeTab, setActiveTab] = useState('entry');
  const [currentLedgerId] = useState(ENV_APP_ID);
  
  const [poData, setPoData] = useState<any[]>([]);
  const [paymentData, setPaymentData] = useState<any>({});
  
  const [currentPo, setCurrentPo] = useState(EMPTY_PO_STATE);
  const [stageInv, setStageInv] = useState(EMPTY_INV_INPUT);

  const [db, setDb] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- AUTO-CALCULATION EFFECT ---
  useEffect(() => {
    const base = parseFloat(stageInv.baseAmount) || 0;
    const gst = parseFloat(stageInv.gst) || 0;
    const fed = parseFloat(stageInv.fed) || 0;
    const wh = parseFloat(stageInv.whTax) || 0;
    const total = base + gst + wh + fed;
    setStageInv(prev => ({ ...prev, amount: total, grossTotal: total }));
  }, [stageInv.baseAmount, stageInv.gst, stageInv.whTax, stageInv.fed]);

  // --- FIREBASE & AUTH ---
  useEffect(() => {
    const initApp = async () => {
        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            const firestore = getFirestore(app);
            setDb(firestore);
            await signInAnonymously(auth);
            onAuthStateChanged(auth, (u) => {
                if (u) {
                  setUser(u);
                  setIsLoading(false);
                }
            });
        } catch (e: any) {
            console.error("Auth Error:", e);
            setError("Authentication failed.");
            setIsLoading(false);
        }
    };
    initApp();
  }, []);

  // --- DATA SYNCING ---
  useEffect(() => {
    if (!db || !user) return; 

    const unsubPo = onSnapshot(
        collection(db, 'artifacts', currentLedgerId, 'public', 'data', 'purchaseOrders'), 
        (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setPoData(data);
        }, 
        (err) => setError(err.message)
    );

    const unsubPayments = onSnapshot(
        collection(db, 'artifacts', currentLedgerId, 'public', 'data', 'payments'), 
        (snapshot) => {
            const pMap: any = {};
            snapshot.docs.forEach(doc => { pMap[doc.id] = doc.data(); });
            setPaymentData(pMap);
        }, 
        (err) => console.error("Payment Sync Error:", err)
    );

    return () => { unsubPo(); unsubPayments(); };
  }, [db, user, currentLedgerId]);

  const handleSavePo = async () => {
    if (!db || !currentPo.poNo) return;
    try {
      const docId = `${currentPo.outlet}_${currentPo.poNo.replace(/\//g, '_')}`;
      await setDoc(doc(db, 'artifacts', currentLedgerId, 'public', 'data', 'purchaseOrders', docId), {
        ...currentPo,
        updatedAt: new Date().toISOString()
      });
      setCurrentPo(EMPTY_PO_STATE);
      alert('PO Saved Successfully!');
    } catch (e: any) {
      alert('Error saving PO: ' + e.message);
    }
  };

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-4">
        <RefreshCw className="w-10 h-10 text-blue-600 animate-spin" />
        <p className="text-gray-500 font-medium">Initializing Application...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-red-100 text-center max-w-md">
        <X className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-800 mb-2">Sync Error</h2>
        <p className="text-gray-600 mb-6">{error}</p>
        <button onClick={() => window.location.reload()} className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold">Retry Connection</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-blue-100">
      {/* HEADER */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/60 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-2.5 rounded-xl shadow-lg shadow-blue-200/50">
              <Activity className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Payment Cycle</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <p className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Production Live</p>
              </div>
            </div>
          </div>
          
          <nav className="flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/40">
            <button 
              onClick={() => setActiveTab('entry')}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${activeTab === 'entry' ? 'bg-white text-blue-600 shadow-md shadow-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Plus className="w-4 h-4" /> Entry
            </button>
            <button 
              onClick={() => setActiveTab('cycle')}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${activeTab === 'cycle' ? 'bg-white text-blue-600 shadow-md shadow-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <PieChart className="w-4 h-4" /> Cycle
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {activeTab === 'entry' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* ENTRY FORM */}
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-white rounded-[2rem] border border-slate-200/60 shadow-sm overflow-hidden">
                <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/30">
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <FileText className="w-4 h-4 text-blue-600" />
                    </div>
                    Purchase Order Details
                  </h2>
                </div>
                
                <div className="p-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1">Branch Outlet</label>
                      <select 
                        className="w-full h-12 px-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none font-medium text-slate-700"
                        value={currentPo.outlet}
                        onChange={(e) => setCurrentPo({...currentPo, outlet: e.target.value})}
                      >
                        {OUTLETS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1">PO Reference</label>
                      <div className="relative">
                        <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          type="text" 
                          className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none font-medium text-slate-700"
                          placeholder="24/0001"
                          value={currentPo.poNo}
                          onChange={(e) => setCurrentPo({...currentPo, poNo: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1">Initial Amount</label>
                      <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          type="number" 
                          className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none font-medium text-slate-700"
                          placeholder="0.00"
                          value={currentPo.poAmount}
                          onChange={(e) => setCurrentPo({...currentPo, poAmount: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4">
                    <button 
                      onClick={handleSavePo}
                      className="w-full md:w-auto flex items-center justify-center gap-3 bg-slate-900 text-white px-10 py-4 rounded-2xl font-bold hover:bg-blue-600 transition-all duration-300 shadow-xl shadow-slate-200 active:scale-[0.98]"
                    >
                      <Save className="w-5 h-5" /> Commit Purchase Order
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* SIDEBAR STATS */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-[2rem] p-8 text-white shadow-xl shadow-slate-200">
                <div className="flex items-center justify-between mb-8">
                  <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-blue-400" />
                  </div>
                  <span className="text-[10px] font-bold bg-white/10 px-3 py-1 rounded-full uppercase tracking-tighter">Overview</span>
                </div>
                <div className="space-y-1">
                  <p className="text-slate-400 text-sm font-medium">Total Volume</p>
                  <h3 className="text-3xl font-black">{formatCurrency(poData.reduce((acc, po) => acc + (parseFloat(po.poAmount) || 0), 0))}</h3>
                </div>
                <div className="mt-8 pt-8 border-t border-white/5 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Orders</p>
                    <p className="text-xl font-bold">{poData.length}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Active</p>
                    <p className="text-xl font-bold text-blue-400">{poData.length}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] border border-slate-200/60 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Database className="w-4 h-4 text-emerald-600" />
                </div>
                Transaction Ledger
              </h2>
              <div className="flex gap-2">
                <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400"><Search className="w-5 h-5" /></button>
                <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400"><Filter className="w-5 h-5" /></button>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-8 py-5 text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">PO Reference</th>
                    <th className="px-8 py-5 text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Location</th>
                    <th className="px-8 py-5 text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Status</th>
                    <th className="px-8 py-5 text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Commitment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {poData.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50/30 transition-all group">
                      <td className="px-8 py-5 font-bold text-slate-700">{po.poNo}</td>
                      <td className="px-8 py-5">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-bold">
                          <MapPin className="w-3 h-3" /> {po.outlet}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold">
                          <CheckCircle className="w-3 h-3" /> Verified
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span className="text-sm font-black text-slate-800 tracking-tight">{formatCurrency(po.poAmount)}</span>
                      </td>
                    </tr>
                  ))}
                  {poData.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-8 py-20 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-200">
                            <ClipboardList className="w-8 h-8" />
                          </div>
                          <p className="text-slate-400 font-medium">No transactions found in ledger</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
