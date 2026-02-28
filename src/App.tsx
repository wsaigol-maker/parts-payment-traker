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

const getPayableMonth = (invoiceDateStr: string) => {
    if (!invoiceDateStr) return '';
    const d = new Date(invoiceDateStr + 'T00:00:00'); // Force local time
    if (isNaN(d.getTime())) return '';
    d.setMonth(d.getMonth() + 3); 
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
};

const getDisplayMonth = (isoDate: string) => {
    if (!isoDate) return '';
    const [year, month] = isoDate.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
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

  if (isLoading) return <div className="p-8 text-center">Initializing App...</div>;
  if (error) return <div className="p-8 text-red-500 text-center">{error}</div>;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-4">
      <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-xl shadow-lg shadow-blue-200">
            <Activity className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-800">Payment Cycle Manager</h1>
            <p className="text-sm text-gray-500 font-medium">Finance & Procurement Tracking</p>
          </div>
        </div>
      </header>

      <nav className="flex gap-2 mb-6 bg-gray-100 p-1.5 rounded-xl w-fit">
        <button 
          onClick={() => setActiveTab('entry')}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'entry' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Data Entry
        </button>
        <button 
          onClick={() => setActiveTab('cycle')}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'cycle' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Payment Cycle
        </button>
      </nav>

      <main className="grid grid-cols-1 gap-6">
        {activeTab === 'entry' ? (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" /> New Purchase Order
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
               <div>
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Outlet</label>
                 <select 
                   className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                   value={currentPo.outlet}
                   onChange={(e) => setCurrentPo({...currentPo, outlet: e.target.value})}
                 >
                   {OUTLETS.map(o => <option key={o} value={o}>{o}</option>)}
                 </select>
               </div>
               <div>
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">PO Number</label>
                 <input 
                   type="text" 
                   className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                   placeholder="e.g. 24/0001"
                   value={currentPo.poNo}
                   onChange={(e) => setCurrentPo({...currentPo, poNo: e.target.value})}
                 />
               </div>
               <div>
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">PO Amount</label>
                 <input 
                   type="number" 
                   className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                   placeholder="0.00"
                   value={currentPo.poAmount}
                   onChange={(e) => setCurrentPo({...currentPo, poAmount: e.target.value})}
                 />
               </div>
            </div>
            <button 
              onClick={handleSavePo}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
            >
              <Save className="w-5 h-5" /> Save Purchase Order
            </button>
          </div>
        ) : (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-4 font-bold text-gray-500 text-xs uppercase">PO No</th>
                  <th className="pb-4 font-bold text-gray-500 text-xs uppercase">Outlet</th>
                  <th className="pb-4 font-bold text-gray-500 text-xs uppercase text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {poData.map((po) => (
                  <tr key={po.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-4 font-medium text-gray-700">{po.poNo}</td>
                    <td className="py-4 text-gray-600">{po.outlet}</td>
                    <td className="py-4 text-right font-semibold">{formatCurrency(po.poAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
