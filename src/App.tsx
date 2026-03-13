import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Trash2, TrendingUp, DollarSign, Download, Save, 
  RefreshCw, Search, Hash, Activity, PieChart,
  Wifi, Calculator, Filter, X, Printer, FileBarChart, Lock, ClipboardList, Upload, FileText, Pointer, AlertTriangle
} from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, Firestore } from 'firebase/firestore';

// --- TYPES (Ensures strict Replit build stability) ---
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
  poAmount: string | number;
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
}

interface EditPaymentState {
  monthKey: string | null;
  run1: number;
  run2: number;
  run3: number;
}

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

// Helper for branch-specific UI colors
const getBranchColor = (outlet: string) => {
  switch (outlet) {
    case 'Dha': return 'blue';
    case 'Jt': return 'orange';
    case 'Qr': return 'emerald';
    default: return 'slate';
  }
};

const formatCurrency = (amount: any) => {
    const val = parseFloat(amount);
    if (isNaN(val)) return `${CURRENCY} 0`;
    return `${CURRENCY} ${val.toLocaleString('en-US')}`;
};

const generateCompositeId = (outlet: string, poNo: string) => {
    if (!outlet || !poNo) return '';
    const cleanPo = poNo.trim().replace(/\//g, '_');
    return `${outlet}_${cleanPo}`;
};

const parseInputDate = (dateStr: string) => {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const cleanStr = dateStr.trim();
    if (cleanStr.includes('/') && cleanStr.split('/').length === 3) {
        const [d, m, y] = cleanStr.split('/');
        return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`);
    }
    if (cleanStr.includes('-') && cleanStr.split('-').length === 3) {
        const parts = cleanStr.split('-');
        if (parts[0].length === 4) return new Date(cleanStr + 'T00:00:00');
        return new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}T00:00:00`);
    }
    return null;
};

const standardizeDate = (dateStr: string) => {
    const d = parseInputDate(dateStr);
    if (!d || isNaN(d.getTime())) return dateStr;
    return d.toISOString().split('T')[0];
};

const formatDisplayDate = (isoDate: string) => {
    if (!isoDate || typeof isoDate !== 'string') return '';
    try {
        const d = parseInputDate(isoDate);
        if (!d || isNaN(d.getTime())) return isoDate;
        return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
    } catch (e) { }
    return isoDate;
};

const getPayableMonthKey = (invoiceDateStr: string) => {
    const d = parseInputDate(invoiceDateStr);
    if (!d || isNaN(d.getTime())) return 'unknown';
    const payableDate = new Date(d.getFullYear(), d.getMonth() + 3, 1);
    return `${payableDate.getFullYear()}-${(payableDate.getMonth() + 1).toString().padStart(2, '0')}`;
};

const getDisplayMonth = (isoMonthKey: string) => {
    if (!isoMonthKey || !isoMonthKey.includes('-')) return 'Pending';
    try {
        const [year, month] = isoMonthKey.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) { return isoMonthKey; }
};

const getPaymentBatch = (invoiceDateStr: string) => {
    const d = parseInputDate(invoiceDateStr);
    if (!d || isNaN(d.getTime())) return 'N/A';
    const day = d.getDate();
    if (day <= 15) return 'Run 1';
    if (day <= 24) return 'Run 2';
    return 'Run 3';
};

const generateNextPoNumber = (transactions: PurchaseOrder[], currentOutlet: string) => {
    const currentYearShort = new Date().getFullYear().toString().slice(-2); 
    const prefix = `${currentYearShort}/`;
    const currentYearPos = transactions
        .filter(t => t.outlet === currentOutlet)
        .map(t => t.poNo)
        .filter(no => no && typeof no === 'string' && no.startsWith(prefix));
    if (currentYearPos.length === 0) return `${prefix}0001`;
    const maxNum = currentYearPos.reduce((max, po) => {
        const parts = po.split('/');
        if (parts.length < 2) return max;
        const part = parseInt(parts[1]);
        return !isNaN(part) && part > max ? part : max;
    }, 0);
    return `${prefix}${(maxNum + 1).toString().padStart(4, '0')}`;
};

const parseCSV = (text: string) => {
    const result: string[][] = [];
    let row: string[] = [];
    let inQuotes = false;
    let val = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') { val += '"'; i++; }
                else { inQuotes = false; }
            } else { val += char; }
        } else {
            if (char === '"') { inQuotes = true; }
            else if (char === ',') { row.push(val); val = ''; }
            else if (char === '\n' || char === '\r') {
                row.push(val); val = '';
                if (row.some(c => c.trim() !== '')) result.push(row);
                row = [];
                if (char === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
            } else { val += char; }
        }
    }
    if (val || row.length > 0) { row.push(val); result.push(row); }
    return result;
};

// --- INITIAL STATES ---
const EMPTY_PO_STATE: PurchaseOrder = { id: '', poNo: '', outlet: 'Dha', poDate: new Date().toISOString().split('T')[0], poAmount: '', dcs: [], invoices: [], status: 'Pending' };
const EMPTY_INV_INPUT: Invoice = { id: '', number: '', date: '', baseAmount: 0, gst: 0, whTax: 0, fed: 0, amount: 0, note: '', isAOS: false };
const EMPTY_DC_INPUT: DeliveryChallan = { id: '', dcNo: '', dcDate: '' };

const App = () => {
  const [activeTab, setActiveTab] = useState('entry');
  const [activeBranchTab, setActiveBranchTab] = useState('Dha');
  const [currentLedgerId, setCurrentLedgerId] = useState(ENV_APP_ID);
  
  const [poData, setPoData] = useState<PurchaseOrder[]>([]);
  const [paymentData, setPaymentData] = useState<Record<string, any>>({});
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [inquiryDates, setInquiryDates] = useState({ from: '', to: '' });
  
  const [currentPo, setCurrentPo] = useState<PurchaseOrder>(EMPTY_PO_STATE);
  const [stageDc, setStageDc] = useState<DeliveryChallan>(EMPTY_DC_INPUT);
  const [stageInv, setStageInv] = useState<Invoice>(EMPTY_INV_INPUT);
  const [editingPayment, setEditingPayment] = useState<EditPaymentState>({ monthKey: null, run1: 0, run2: 0, run3: 0 });
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const [db, setDb] = useState<Firestore | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentAction, setCurrentAction] = useState('ADD'); 

  // Auto-calculation for Invoice form
  useEffect(() => {
    const base = parseFloat(stageInv.baseAmount as any) || 0;
    const gst = parseFloat(stageInv.gst as any) || 0;
    const fed = parseFloat(stageInv.fed as any) || 0;
    const wh = parseFloat(stageInv.whTax as any) || 0;
    setStageInv(prev => ({ ...prev, amount: base + gst + wh + fed }));
  }, [stageInv.baseAmount, stageInv.gst, stageInv.whTax, stageInv.fed]);

  // Auth/DB Init
  useEffect(() => {
    const initApp = async () => {
        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            const firestore = getFirestore(app);
            setDb(firestore);
            await signInAnonymously(auth);
            onAuthStateChanged(auth, (u) => { if (u) { setUser(u); setIsLoading(false); } });
        } catch (e: any) {
            setError("Authentication failed.");
            setIsLoading(false);
        }
    };
    initApp();
  }, []);

  // Sync Listeners
  useEffect(() => {
    if (!db || !user) return; 
    const unsubPo = onSnapshot(collection(db, 'artifacts', currentLedgerId, 'public', 'data', 'purchaseOrders'), 
        (snapshot) => {
            const data = snapshot.docs.map(doc => {
                const d = doc.data() as any;
                const invoices = (d.invoices || []).map((inv: any, idx: number) => ({ 
                    id: inv.id || `inv-${doc.id}-${idx}`,
                    ...inv, 
                    date: standardizeDate(inv.date),
                    amount: parseFloat(inv.amount) || 0,
                    baseAmount: parseFloat(inv.baseAmount) || 0
                }));
                const dcs = (d.dcs || []).map((dc: any, idx: number) => ({
                    id: dc.id || `dc-${doc.id}-${idx}`,
                    ...dc,
                    dcDate: standardizeDate(dc.dcDate)
                }));
                return { 
                    id: doc.id, 
                    ...d, 
                    poDate: standardizeDate(d.poDate),
                    dcs,
                    invoices 
                } as PurchaseOrder;
            });
            setPoData(data);
        }, 
        (err) => setError(`Sync Error: ${err.message}`)
    );

    const unsubPayments = onSnapshot(collection(db, 'artifacts', currentLedgerId, 'public', 'data', 'payments'), 
        (snapshot) => {
            const pMap: Record<string, any> = {};
            snapshot.docs.forEach((doc) => { pMap[doc.id] = doc.data(); });
            setPaymentData(pMap);
        }
    );

    return () => { unsubPo(); unsubPayments(); };
  }, [db, user, currentLedgerId]);

  const transactions = useMemo(() => poData, [poData]);

  // Top Board Stats
  const stats = useMemo(() => {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
      let purchasing = 0, totalInv = 0, aosInv = 0, payable = 0, openPoValue = 0;

      transactions.forEach(t => {
          const poAmt = parseFloat(t.poAmount as string) || 0;
          if(t.poDate && t.poDate.startsWith(monthKey)) {
              const hasInv = t.invoices && t.invoices.length > 0 && t.invoices.some(i => (parseFloat(i.amount as any) || 0) > 0);
              if (!hasInv) openPoValue += poAmt;
          }
          t.invoices.forEach(inv => {
              if(!inv.date) return;
              const invAmt = parseFloat(inv.amount as any) || 0;
              const invBase = parseFloat(inv.baseAmount as any) || 0;
              if (inv.date.startsWith(monthKey)) {
                  purchasing += invBase;
                  totalInv++;
                  if(inv.isAOS) aosInv++;
              }
              if (getPayableMonthKey(inv.date) === monthKey) {
                  payable += invAmt;
              }
          });
      });
      return { purchasing, totalInv, aosInv, payable, openPoValue, aosPerc: totalInv > 0 ? Math.round((aosInv / totalInv) * 100) : 0 };
  }, [transactions]);

  // Projection Summary logic - restored to include Run and Branch details
  const summaryData = useMemo(() => {
      const grouping: Record<string, PaymentRow> = {};
      transactions.forEach(t => {
          t.invoices.forEach(inv => {
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
              const amt = parseFloat(inv.amount as any)||0;
              if (batch === 'Run 1') grouping[monthKey].run1 += amt;
              else if (batch === 'Run 2') grouping[monthKey].run2 += amt;
              else if (batch === 'Run 3') grouping[monthKey].run3 += amt;
              
              if (t.outlet === 'Dha') grouping[monthKey].Dha += amt;
              else if (t.outlet === 'Jt') grouping[monthKey].Jt += amt;
              else if (t.outlet === 'Qr') grouping[monthKey].Qr += amt;

              if (inv.isAOS) grouping[monthKey].aosTotal += amt;
              grouping[monthKey].Total += amt;
          });
      });
      Object.keys(paymentData).forEach(mKey => {
           if(!grouping[mKey]) {
             grouping[mKey] = { monthKey: mKey, label: getDisplayMonth(mKey), run1: 0, run2: 0, run3: 0, Dha: 0, Jt: 0, Qr: 0, aosTotal: 0, Total: 0, paidRun1: paymentData[mKey].run1 || 0, paidRun2: paymentData[mKey].run2 || 0, paidRun3: paymentData[mKey].run3 || 0 };
           }
      });
      return Object.values(grouping).sort((a,b) => a.monthKey.localeCompare(b.monthKey));
  }, [transactions, paymentData]);

  const openPoList = useMemo(() => {
      return transactions.filter(t => !(t.invoices && t.invoices.length > 0 && t.invoices.some(i => (parseFloat(i.amount as any) || 0) > 0)))
             .sort((a,b) => b.poDate.localeCompare(a.poDate));
  }, [transactions]);

  const inquiryData = useMemo(() => {
    const results: Record<string, any[]> = { Dha: [], Jt: [], Qr: [] };
    const fromStr = inquiryDates.from || '1970-01-01';
    const toStr = inquiryDates.to || '2099-12-31';
    transactions.forEach(po => {
        if (!po.invoices || !OUTLETS.includes(po.outlet)) return;
        po.invoices.forEach(inv => {
            if (inv.date >= fromStr && inv.date <= toStr) {
                results[po.outlet].push({ id: inv.id, number: inv.number, date: inv.date, amount: parseFloat(inv.amount as any) || 0 });
            }
        });
    });
    OUTLETS.forEach(o => results[o].sort((a: any, b: any) => a.date.localeCompare(b.date)));
    return results;
  }, [transactions, inquiryDates]);

  // Management controls
  const loadPoForEditing = (po: PurchaseOrder) => {
    setCurrentPo({ ...po });
    setCurrentAction('UPDATE');
    setActiveBranchTab(po.outlet);
    setStageDc(EMPTY_DC_INPUT);
    setStageInv(EMPTY_INV_INPUT);
    setActiveTab('entry');
  };

  const handlePoLookup = () => {
    const poNo = currentPo.poNo.trim();
    if (!poNo) return;
    // Strictly search within the currently active branch as requested
    const existing = transactions.find(t => t.poNo === poNo && t.outlet === activeBranchTab);
    if (existing) { 
        loadPoForEditing(existing); 
    } else { 
        setCurrentPo({ ...EMPTY_PO_STATE, poNo, outlet: activeBranchTab }); 
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
              dcs: currentPo.dcs.map(({_isSessionNew, ...d}: any) => ({ ...d, dcDate: standardizeDate(d.dcDate) })),
              invoices: currentPo.invoices.map(({_isSessionNew, ...i}: any) => ({ ...i, date: standardizeDate(i.date) })),
              lastUpdated: new Date().toISOString(), 
              status: currentPo.invoices.length > 0 ? 'Invoiced' : 'Pending' 
          };
          await setDoc(doc(db, 'artifacts', currentLedgerId, 'public', 'data', 'purchaseOrders', docId), poToSave);
          setCurrentPo({ ...EMPTY_PO_STATE, outlet: activeBranchTab });
          setStageDc(EMPTY_DC_INPUT); setStageInv(EMPTY_INV_INPUT); setCurrentAction('ADD');
          setError("Record Saved Successfully!"); setTimeout(() => setError(null), 3000);
      } catch (e: any) { setError(`Save failed: ${e.message}`); }
  };

  const executeFinalDelete = async () => {
    if (!db || !user || !currentPo.poNo) {
      setError("Delete failed: No active record loaded.");
      return;
    }
    const docId = generateCompositeId(currentPo.outlet, currentPo.poNo);
    try {
      const docRef = doc(db, 'artifacts', currentLedgerId, 'public', 'data', 'purchaseOrders', docId);
      await deleteDoc(docRef);
      setIsDeleteModalOpen(false);
      setCurrentPo({ ...EMPTY_PO_STATE, outlet: activeBranchTab });
      setCurrentAction('ADD');
      setError("Record Successfully Deleted.");
      setTimeout(() => setError(null), 3000);
    } catch (err: any) {
      setError("Deletion Error: " + err.message);
    }
  };

  const downloadCSV = () => {
    const headers = ["PO #", "Outlet", "PO Date", "Estimated Amount", "Inv #", "Inv Date", "Base Amt", "GST", "WH", "FED", "Total", "Status"];
    let rows = [headers.join(",")];
    transactions.forEach(t => {
        if (t.invoices && t.invoices.length > 0) {
            t.invoices.forEach(inv => {
                rows.push([`"${t.poNo}"`, t.outlet, t.poDate, t.poAmount || 0, `"${inv.number||''}"`, inv.date, inv.baseAmount, inv.gst, inv.whTax, inv.fed, inv.amount, t.status].join(","));
            });
        } else {
             rows.push([`"${t.poNo}"`, t.outlet, t.poDate, t.poAmount || 0, '', '', 0, 0, 0, 0, 0, t.status].join(","));
        }
    });
    const blob = new Blob([rows.join("\n")], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Cloud_Export.csv`; a.click();
  };

  const downloadOpenPoReport = () => {
    const headers = ["PO #", "Outlet", "PO Date", "Estimated Amount", "Status"];
    const rows = [headers.join(",")];
    openPoList.forEach(t => rows.push([`"${t.poNo}"`, t.outlet, t.poDate, t.poAmount || 0, "Open"].join(",")));
    const blob = new Blob([rows.join("\n")], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `OpenPO_Report.csv`; a.click();
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev: any) => {
        try {
            const rows = parseCSV(ev.target.result);
            const headers = rows[0].map(h => h.trim());
            const poMap: Record<string, any> = {};
            rows.slice(1).forEach(row => {
                const poNo = (row[headers.indexOf("PO #")] || "").trim();
                const outlet = (row[headers.indexOf("Outlet")] || "").trim();
                if (!poNo || !outlet) return;
                const id = generateCompositeId(outlet, poNo);
                if (!poMap[id]) poMap[id] = { poNo, outlet, poDate: standardizeDate(row[headers.indexOf("PO Date")]), poAmount: parseFloat(row[headers.indexOf("Estimated Amount")] || row[headers.indexOf("PO Amount (Est)")]), dcs: [], invoices: [] };
                
                const invNo = row[headers.indexOf("Inv #")];
                if (invNo) {
                    poMap[id].invoices.push({ 
                        id: generateUID(), number: invNo, date: standardizeDate(row[headers.indexOf("Inv Date")]), 
                        baseAmount: parseFloat(row[headers.indexOf("Base Amt")] || "0"), gst: parseFloat(row[headers.indexOf("GST")]), whTax: parseFloat(row[headers.indexOf("WH")]), fed: parseFloat(row[headers.indexOf("FED")]), amount: parseFloat(row[headers.indexOf("Total")]), isAOS: (row[headers.indexOf("AOS Type")] || "").toLowerCase() === 'yes', note: row[headers.indexOf("Note")] || "" 
                    });
                }
            });
            await Promise.all(Object.entries(poMap).map(([id, data]) => setDoc(doc(db, 'artifacts', currentLedgerId, 'public', 'data', 'purchaseOrders', id), data, { merge: true })));
            setError("Import Success!");
        } catch (err: any) { setError("Import failed: " + err.message); }
        finally { setIsLoading(false); e.target.value = ''; }
    };
    reader.readAsText(file);
  };

  if (isLoading) return <div className="p-10 text-center font-bold text-blue-600">Connecting Database...</div>;

  return (
    <div className="max-w-7xl mx-auto bg-gray-50 min-h-screen p-4 font-sans text-gray-800">
      
      {/* DELETE MODAL */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4"><AlertTriangle size={32} /></div>
              <h2 className="text-xl font-extrabold text-slate-900 mb-2">Delete Record?</h2>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                Permanently delete PO <span className="font-bold text-slate-800">#{currentPo.poNo}</span>? 
                This action is for the <span className={`font-black uppercase text-${getBranchColor(currentPo.outlet)}-600`}>{currentPo.outlet} Branch</span>.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all">Cancel</button>
                <button onClick={executeFinalDelete} className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-200">Confirm Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-slate-900 text-white p-6 rounded-t-xl shadow-lg mb-6 flex flex-col md:flex-row justify-between items-center gap-4 print:hidden">
        <div>
            <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight text-white"><DollarSign className="text-emerald-400" /> P2P Cloud Manager</h1>
            <p className="text-[10px] text-slate-500 font-mono uppercase mt-1 tracking-widest">Database: {currentLedgerId}</p>
        </div>
        <div className="flex gap-2">
            <input type="file" accept=".csv" id="csv-up" className="hidden" onChange={handleImportCSV} />
            <label htmlFor="csv-up" className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 cursor-pointer shadow-sm transition-all"><Upload size={14} /> Import</label>
            <button onClick={downloadCSV} className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 transition-all shadow-sm"><Download size={14} /> Export All</button>
            <button onClick={() => { setCurrentPo({ ...EMPTY_PO_STATE, outlet: activeBranchTab }); setCurrentAction('ADD'); }} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 shadow-sm transition-all"><RefreshCw size={14} /> New Record</button>
        </div>
      </div>

      {error && <div className={`p-3 rounded mb-4 text-sm font-semibold border-l-4 ${String(error).includes("Deleted") ? 'bg-green-50 text-green-800 border-green-500' : 'bg-yellow-100 text-yellow-800 border-yellow-500'}`}>{String(error)}</div>}

      <div className="flex gap-2 mb-6 border-b border-gray-200 print:hidden overflow-x-auto">
          {['entry', 'summary', 'reconcile', 'reports', 'inquiry'].map((t, idx) => (
              <button key={`tab-btn-${t}`} onClick={() => setActiveTab(t)} className={`px-4 py-2 font-bold text-sm rounded-t-lg transition-all whitespace-nowrap ${activeTab===t ? 'bg-white text-blue-600 border-t border-x shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>{idx+1}. {t === 'entry' ? 'MANAGEMENT' : t.toUpperCase()}</button>
          ))}
      </div>

      {activeTab === 'entry' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-12 mb-2 flex gap-1">
                {OUTLETS.map(o => (
                    <button 
                      key={`branch-btn-${o}`} 
                      onClick={() => { setActiveBranchTab(o); if(currentAction === 'ADD') setCurrentPo(prev => ({ ...prev, outlet: o })); }} 
                      className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all shadow-sm
                        ${activeBranchTab === o 
                          ? `${o==='Dha' ? 'bg-blue-600' : o==='Jt' ? 'bg-orange-500' : 'bg-emerald-600'} text-white ring-2 ring-offset-1 ring-${getBranchColor(o)}-500` 
                          : 'bg-white text-slate-500 hover:bg-slate-100'}`}
                    >{o} Branch</button>
                ))}
            </div>

            <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
                 <div className="bg-amber-50 p-4 rounded-lg border-l-4 border-amber-500 flex items-center justify-between shadow-sm"><div><p className="text-xs font-bold text-amber-500 uppercase tracking-widest">Open POs</p><p className="text-xl font-black text-amber-900">{formatCurrency(stats.openPoValue)}</p></div><FileText className="text-amber-200" /></div>
                 <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500 flex items-center justify-between shadow-sm"><div><p className="text-xs font-bold text-blue-400 uppercase tracking-widest">Purchasing (Base)</p><p className="text-xl font-black text-blue-900">{formatCurrency(stats.purchasing)}</p></div><Activity className="text-blue-200" /></div>
                 <div className="bg-indigo-50 p-4 rounded-lg border-l-4 border-indigo-500 flex items-center justify-between shadow-sm"><div><p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">AOS Ratio</p><p className="text-xl font-black text-indigo-900">{stats.aosPerc}%</p></div><PieChart className="text-indigo-200" /></div>
                 <div className="bg-green-50 p-4 rounded-lg border-l-4 border-green-500 flex items-center justify-between shadow-sm"><div><p className="text-xs font-bold text-green-500 uppercase tracking-widest">Total DUE</p><p className="text-xl font-black text-green-900">{formatCurrency(stats.payable)}</p></div><DollarSign className="text-green-200" /></div>
            </div>
            
            <div className="lg:col-span-5 space-y-4">
                <div className={`bg-white p-5 rounded-lg shadow border ${currentAction === 'UPDATE' ? `border-${getBranchColor(activeBranchTab)}-200 bg-${getBranchColor(activeBranchTab)}-50/10` : 'border-blue-100'}`}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2"><Hash size={16} /> PO Master ({activeBranchTab})</h3>
                        {currentAction === 'UPDATE' && <span className={`bg-${getBranchColor(activeBranchTab)}-100 text-${getBranchColor(activeBranchTab)}-700 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider`}>Locked Record</span>}
                    </div>
                    <div className="mb-4">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">PO Number</label>
                        <div className="flex gap-2 mt-1">
                            <input type="text" value={currentPo.poNo} onChange={e => setCurrentPo({...currentPo, poNo: e.target.value})} onBlur={handlePoLookup} onKeyDown={(e) => { if(e.key === 'Enter') handlePoLookup(); }} disabled={currentAction === 'UPDATE'} className={`flex-1 p-2 border-2 rounded font-mono font-bold ${currentAction === 'UPDATE' ? 'bg-gray-100 border-gray-200 cursor-not-allowed text-slate-400' : 'border-blue-200 focus:border-blue-500'}`} />
                            {currentAction === 'ADD' && <button onClick={() => setCurrentPo({...currentPo, poNo: generateNextPoNumber(transactions, activeBranchTab)})} className="bg-blue-100 text-blue-700 px-3 rounded text-xs font-bold hover:bg-blue-200 transition-colors">Auto</button>}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div><label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Date</label><input type="date" value={currentPo.poDate} onChange={e => setCurrentPo({...currentPo, poDate: e.target.value})} disabled={currentAction === 'UPDATE'} className={`w-full p-2 mt-1 border rounded ${currentAction === 'UPDATE' ? 'bg-gray-100 cursor-not-allowed text-slate-400' : ''}`} /></div>
                        <div><label className="text-xs font-bold text-amber-600 uppercase tracking-widest">Amount (Est.)</label><input type="number" value={currentPo.poAmount} onChange={e => setCurrentPo({...currentPo, poAmount: e.target.value})} disabled={currentAction === 'UPDATE'} className={`w-full p-2 mt-1 border rounded font-bold text-amber-700 ${currentAction === 'UPDATE' ? 'bg-gray-100 cursor-not-allowed text-slate-400' : ''}`} /></div>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-lg shadow border border-orange-100 relative">
                    <h3 className="text-sm font-bold text-slate-500 uppercase mb-3 text-orange-700">Delivery Challans</h3>
                    <div className="flex gap-2 mb-3 items-end bg-orange-50 p-3 rounded">
                        <div className="flex-1"><label className="text-[10px] text-orange-600 uppercase font-bold">New DC #</label><input type="text" value={stageDc.dcNo} onChange={e => setStageDc({...stageDc, dcNo: e.target.value})} className="w-full p-1 border rounded text-sm bg-white" /></div>
                        <div className="flex-1"><label className="text-[10px] text-orange-600 uppercase font-bold">Date</label><input type="date" value={stageDc.dcDate} onChange={e => setStageDc({...stageDc, dcDate: e.target.value})} className="w-full p-1 border rounded text-sm bg-white" /></div>
                        <button onClick={() => { if(!stageDc.dcNo || !stageDc.dcDate) return; setCurrentPo({...currentPo, dcs: [...currentPo.dcs, { ...stageDc, id: generateUID(), _isSessionNew: true }]}); setStageDc(EMPTY_DC_INPUT); }} className="bg-orange-500 text-white p-1.5 rounded hover:bg-orange-600 transition-colors"><Plus size={16} /></button>
                    </div>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                        {currentPo.dcs.map((dc, idx) => (
                            <div key={`form-dc-row-${dc.id || idx}`} className="flex justify-between items-center text-xs p-1.5 bg-gray-50 rounded border-l-2 border-orange-300">
                                <span>{dc.dcNo} | {formatDisplayDate(dc.dcDate)}</span>
                                {(currentAction === 'ADD' || dc._isSessionNew) && (<button onClick={() => setCurrentPo({...currentPo, dcs: currentPo.dcs.filter(d=>d.id !== dc.id)})} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>)}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-white p-5 rounded-lg shadow border border-green-100">
                    <h3 className="text-sm font-bold text-slate-500 uppercase mb-3 text-green-700">Invoice Items</h3>
                    <div className="bg-green-50 p-4 rounded mb-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div><label className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Inv #</label><input type="text" value={stageInv.number} onChange={e => setStageInv({...stageInv, number: e.target.value})} className="w-full p-1.5 border rounded text-xs" /></div>
                            <div><label className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Date</label><input type="date" value={stageInv.date} onChange={e => setStageInv({...stageInv, date: e.target.value})} className="w-full p-1.5 border rounded text-xs" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div><label className="text-[10px] text-blue-600 uppercase font-bold tracking-widest">Base Amount</label><input type="number" value={stageInv.baseAmount} onChange={e => setStageInv({...stageInv, baseAmount: parseFloat(e.target.value) || 0})} className="w-full p-1.5 border border-blue-200 rounded text-xs font-bold" /></div>
                            <div><label className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">G.S.T</label><input type="number" value={stageInv.gst} onChange={e => setStageInv({...stageInv, gst: parseFloat(e.target.value) || 0})} className="w-full p-1.5 border rounded text-xs" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div><label className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">WH Tax</label><input type="number" value={stageInv.whTax} onChange={e => setStageInv({...stageInv, whTax: parseFloat(e.target.value) || 0})} className="w-full p-1.5 border rounded text-xs" /></div>
                            <div><label className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">FED</label><input type="number" value={stageInv.fed} onChange={e => setStageInv({...stageInv, fed: parseFloat(e.target.value) || 0})} className="w-full p-1.5 border rounded text-xs" /></div>
                        </div>
                        <div className="flex items-center justify-between bg-white/50 p-2 rounded border border-green-200">
                            <div><label className="text-[9px] font-bold text-green-700 uppercase tracking-wider">Total Payable</label><div className="text-xl font-black text-green-800">{formatCurrency(stageInv.amount)}</div></div>
                            <div className="flex flex-col items-end gap-2">
                                <label className="flex items-center text-[10px] text-gray-500 cursor-pointer"><input type="checkbox" checked={stageInv.isAOS} onChange={e => setStageInv({...stageInv, isAOS: e.target.checked})} className="mr-1" /> AOS</label>
                                <button onClick={() => { if(!stageInv.baseAmount || !stageInv.date) return; setCurrentPo({...currentPo, invoices: [...currentPo.invoices, {...stageInv, id: generateUID(), _isSessionNew: true}]}); setStageInv(EMPTY_INV_INPUT); }} className="bg-green-600 text-white px-4 py-2 rounded text-xs font-bold shadow-sm hover:bg-green-700 transition-colors">+ Add</button>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                        {currentPo.invoices.map((inv, idx) => (
                            <div key={`form-inv-row-${inv.id || idx}`} className="flex justify-between items-center text-xs p-1.5 bg-gray-50 rounded border-l-2 border-green-300">
                                <div><div className="font-bold text-green-800">{formatCurrency(inv.amount)}</div><div className="text-[9px] text-gray-400">#{inv.number} | Base: {formatCurrency(inv.baseAmount)}</div></div>
                                {(currentAction === 'ADD' || inv._isSessionNew) && (<button onClick={() => setCurrentPo({...currentPo, invoices: currentPo.invoices.filter(i=>i.id !== inv.id)})} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>)}
                            </div>
                        ))}
                    </div>
                </div>
                
                <div className="flex gap-3">
                   <button onClick={handleSave} className="flex-[2] bg-slate-800 text-white py-3 rounded-xl shadow-lg font-bold transition-all hover:bg-slate-700 flex items-center justify-center gap-2"><Save size={18} /> Save Records</button>
                   {currentAction === 'UPDATE' && (
                     <button onClick={() => setIsDeleteModalOpen(true)} className="flex-1 bg-white border-2 border-red-200 text-red-600 py-3 rounded-xl font-bold transition-all hover:bg-red-50 flex items-center justify-center gap-2"><Trash2 size={18} /> Delete</button>
                   )}
                </div>
            </div>

            <div className="lg:col-span-7 overflow-x-auto">
                <div className="bg-white rounded-lg shadow border overflow-hidden">
                    <div className="bg-gray-100 p-3 border-b text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                        <Pointer size={14} className="text-blue-500" /> Journal (Click to manage)
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-400 border-b"><tr><th className="p-3 text-left">PO #</th><th className="p-3 text-left">Date</th><th className="p-3 text-left">Stats</th></tr></thead>
                        <tbody className="divide-y">
                            {transactions.filter(t => t.outlet === activeBranchTab).sort((a,b) => b.poNo.localeCompare(a.poNo)).map((t, idx) => (
                                <tr key={`journal-row-${t.id || idx}`} onClick={() => loadPoForEditing(t)} className="hover:bg-blue-50 transition cursor-pointer group">
                                    <td className="p-3 font-mono font-bold text-blue-600 flex items-center gap-2">{t.poNo} <Search size={12} className="opacity-0 group-hover:opacity-100 text-blue-400" /></td>
                                    <td className="p-3 text-xs">{formatDisplayDate(t.poDate)}</td>
                                    <td className="p-3 text-xs text-green-600 font-bold">{t.invoices.length} Inv ({formatCurrency(t.invoices.reduce((s,i)=>s+i.amount,0))})</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}

      {activeTab === 'summary' && (
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200 overflow-x-auto">
            <h2 className="text-xl font-bold mb-4 text-slate-800 font-bold">HO Outflow Projection</h2>
            <table className="w-full text-sm border-collapse whitespace-nowrap">
                <thead><tr className="bg-slate-800 text-white text-xs uppercase">
                    <th className="p-3 text-left">Payable Month</th>
                    <th className="p-3 text-right">Run 1</th><th className="p-3 text-right">Run 2</th><th className="p-3 text-right">Run 3</th>
                    {OUTLETS.map(o => <th key={`head-o-${o}`} className="p-3 text-right">{o}</th>)}
                    <th className="p-3 text-right bg-green-700 text-white font-bold">Total Outflow</th>
                </tr></thead>
                <tbody>{summaryData.map((row, idx) => (<tr key={`summary-row-${row.monthKey}-${idx}`} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-bold">{row.label}</td>
                    <td className="p-3 text-right text-slate-500 font-mono">{formatCurrency(row.run1)}</td>
                    <td className="p-3 text-right text-slate-500 font-mono">{formatCurrency(row.run2)}</td>
                    <td className="p-3 text-right text-slate-500 font-mono">{formatCurrency(row.run3)}</td>
                    {OUTLETS.map(o => <td key={`summary-cell-${row.monthKey}-${o}`} className="p-3 text-right font-mono text-gray-500">{formatCurrency((row as any)[o])}</td>)}
                    <td className="p-3 text-right font-bold text-green-800 bg-green-50">{formatCurrency(row.Total)}</td>
                </tr>))}</tbody>
            </table>
        </div>
      )}

      {activeTab === 'reconcile' && (
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200 overflow-x-auto">
            <h2 className="text-xl font-bold mb-4 text-slate-800 tracking-tight font-bold">Payment Reconciliation</h2>
            <table className="w-full text-sm border-collapse whitespace-nowrap">
                <thead><tr className="bg-slate-800 text-white text-xs uppercase">
                    <th className="p-3 text-left">Month</th><th className="p-3 text-right">Accrued</th>
                    <th className="p-3 text-right">Run 1 Paid</th><th className="p-3 text-right">Run 2 Paid</th><th className="p-3 text-right">Run 3 Paid</th>
                    <th className="p-3 text-right bg-red-900 text-white">Balance</th><th className="p-3 text-center">Action</th>
                </tr></thead>
                <tbody>{summaryData.map((row, idx) => {
                    const totalPaid = (row.paidRun1 || 0) + (row.paidRun2 || 0) + (row.paidRun3 || 0);
                    const bal = row.Total - totalPaid;
                    const isEditing = editingPayment.monthKey === row.monthKey;
                    return (
                        <tr key={`reconcile-row-${row.monthKey}-${idx}`} className="border-b hover:bg-gray-50 transition-colors">
                            <td className="p-3 font-bold">{row.label}</td><td className="p-3 text-right font-bold text-emerald-800 font-mono">{formatCurrency(row.Total)}</td>
                            <td className="p-3 text-right font-mono">{isEditing ? <input type="number" value={editingPayment.run1} onChange={e => setEditingPayment({...editingPayment, run1: parseFloat(e.target.value) || 0})} className="border rounded p-1 w-20 text-right text-xs" /> : formatCurrency(row.paidRun1)}</td>
                            <td className="p-3 text-right font-mono">{isEditing ? <input type="number" value={editingPayment.run2} onChange={e => setEditingPayment({...editingPayment, run2: parseFloat(e.target.value) || 0})} className="border rounded p-1 w-20 text-right text-xs" /> : formatCurrency(row.paidRun2)}</td>
                            <td className="p-3 text-right font-mono">{isEditing ? <input type="number" value={editingPayment.run3} onChange={e => setEditingPayment({...editingPayment, run3: parseFloat(e.target.value) || 0})} className="border rounded p-1 w-20 text-right text-xs" /> : formatCurrency(row.paidRun3)}</td>
                            <td className={`p-3 text-right font-bold font-mono ${bal > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(bal)}</td>
                            <td className="p-3 text-center">
                                {isEditing ? (
                                  <div className="flex gap-1 justify-center">
                                    <button onClick={async () => { if(!db) return; try { await setDoc(doc(db, 'artifacts', currentLedgerId, 'public', 'data', 'payments', row.monthKey), { run1: editingPayment.run1, run2: editingPayment.run2, run3: editingPayment.run3 }, { merge: true }); setEditingPayment({monthKey:null, run1:0, run2:0, run3:0}); } catch (err: any) { setError("Save failed: " + err.message); }}} className="bg-green-600 text-white px-2 py-1 rounded text-xs shadow-sm hover:bg-green-700 transition-colors">Save</button>
                                    <button onClick={()=>setEditingPayment({monthKey:null, run1:0, run2:0, run3:0})} className="bg-gray-400 text-white px-2 py-1 rounded text-xs hover:bg-gray-500 transition-colors">X</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setEditingPayment({monthKey: row.monthKey, run1: row.paidRun1, run2: row.paidRun2, run3: row.paidRun3 })} className="bg-slate-700 text-white px-3 py-1 rounded text-xs shadow-sm hover:bg-slate-800 transition-colors">Edit</button>
                                )}
                            </td>
                        </tr>
                    );
                })}</tbody>
            </table>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-bold flex items-center gap-2 text-slate-800 font-bold"><FileText className="text-amber-500" /> Open Purchase Orders</h2><button onClick={downloadOpenPoReport} className="bg-amber-600 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 hover:bg-amber-500 transition-colors shadow-sm"><Download size={14} /> Download</button></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                  <thead><tr className="bg-slate-800 text-white text-xs uppercase"><th className="p-3 text-left">PO #</th><th className="p-3 text-left">Outlet</th><th className="p-3 text-left">PO Date</th><th className="p-3 text-right">Est Amount</th><th className="p-3 text-center">Status</th></tr></thead>
                  <tbody>
                    {openPoList.map((t, i) => (<tr key={`report-row-${t.id || `idx-${i}`}`} className="border-b hover:bg-gray-50 transition-colors"><td className="p-3 font-mono font-bold text-blue-700">{t.poNo}</td><td className="p-3 font-bold text-slate-600">{t.outlet}</td><td className="p-3 text-slate-500">{formatDisplayDate(t.poDate)}</td><td className="p-3 text-right font-bold text-amber-700 font-mono">{formatCurrency(t.poAmount)}</td><td className="p-3 text-center"><span className="bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest">Open</span></td></tr>))}
                    {openPoList.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-gray-300 italic font-medium">No open records found.</td></tr>}
                  </tbody>
              </table>
            </div>
        </div>
      )}

      {activeTab === 'inquiry' && (
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 border-b pb-4">
                <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800 font-bold"><ClipboardList className="text-blue-600" /> Invoice Period Inquiry</h2>
                <div className="flex items-center gap-2 bg-blue-50 p-2 rounded-lg border border-blue-100">
                    <div className="flex flex-col"><label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">From</label><input type="date" value={inquiryDates.from} onChange={e => setInquiryDates({...inquiryDates, from: e.target.value})} className="bg-transparent text-sm outline-none font-semibold" /></div>
                    <div className="text-blue-300 mx-2">→</div>
                    <div className="flex flex-col"><label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">To</label><input type="date" value={inquiryDates.to} onChange={e => setInquiryDates({...inquiryDates, to: e.target.value})} className="bg-transparent text-sm outline-none font-semibold" /></div>
                    {(inquiryDates.from || inquiryDates.to) && <button onClick={() => setInquiryDates({from:'', to:''})} className="bg-white p-1 rounded-full text-red-500 shadow-sm ml-2 transition-transform hover:scale-110"><X size={14} /></button>}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {OUTLETS.map(outlet => {
                    const branchList = inquiryData[outlet] || [];
                    const branchTotal = branchList.reduce((sum: number, item: any) => sum + item.amount, 0);
                    return (
                        <div key={`inq-panel-${outlet}`} className="flex flex-col border rounded-lg overflow-hidden shadow-sm">
                            <div className={`p-2 font-bold text-center uppercase tracking-widest text-[10px] ${outlet === 'Dha' ? 'bg-slate-800 text-white' : outlet === 'Jt' ? 'bg-blue-700 text-white' : 'bg-emerald-700 text-white'}`}>{outlet} Branch</div>
                            <div className="overflow-hidden">
                                <table className="w-full text-[11px] text-left border-collapse">
                                    <thead className="bg-gray-50 border-b"><tr><th className="p-2 border-r w-10 text-center">#</th><th className="p-2 border-r">Inv No.</th><th className="p-2 border-r">Date</th><th className="p-2 text-right">Payable</th></tr></thead>
                                    <tbody className="divide-y">{branchList.map((item, idx) => (
                                        <tr key={`inquiry-row-${outlet}-${item.id || `idx-${idx}`}`} className="hover:bg-gray-50 transition-colors"><td className="p-2 border-r text-center text-gray-400">{idx + 1}</td><td className="p-2 border-r font-mono font-bold text-slate-700">{item.number || '---'}</td><td className="p-2 border-r whitespace-nowrap">{formatDisplayDate(item.date)}</td><td className="p-2 text-right font-mono text-slate-600">{formatCurrency(item.amount)}</td></tr>
                                    ))}
                                    {branchList.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-300 italic font-medium">No matches in range</td></tr>}
                                    </tbody>
                                    <tfoot className="bg-gray-50 font-bold border-t-2"><tr><td colSpan={3} className="p-2 text-right uppercase text-[9px] tracking-widest text-slate-500">Total:</td><td className="p-2 text-right font-mono text-slate-800">{formatCurrency(branchTotal)}</td></tr></tfoot>
                                </table>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="bg-slate-900 text-white p-5 rounded-xl flex justify-between items-center shadow-lg border-t-4 border-blue-500">
                <div className="flex items-center gap-3"><div className="bg-blue-500/20 p-2 rounded-lg"><Calculator className="text-blue-400" /></div><div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Inquiry Grand Total</p><p className="text-[10px] text-slate-500 italic font-bold">Aggregated amount for selected period</p></div></div>
                <div className="text-right"><p className="text-3xl font-black text-white font-mono tracking-tighter">{formatCurrency(Object.values(inquiryData).flat().reduce((s,i)=>s+i.amount, 0))}</p></div>
            </div>
        </div>
      )}
      
      <div className="fixed bottom-0 left-0 w-full bg-slate-800 text-white text-[10px] p-1 px-4 flex justify-between items-center z-50 opacity-90 print:hidden shadow-lg border-t border-slate-700">
          <div className="flex gap-4"><span className="flex items-center gap-1 text-green-400 font-bold"><Wifi size={10} /> Cloud Sync Active</span><span>Records: {transactions.length}</span></div><div className="text-slate-500 font-mono uppercase tracking-wider">Ledger: {currentLedgerId.substring(0,10)}...</div>
      </div>
    </div>
  );
};

export default App;