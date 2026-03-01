import React, { useState, useMemo, useEffect } from "react";
import {
    Plus,
    Trash2,
    TrendingUp,
    DollarSign,
    Download,
    Save,
    RefreshCw,
    Search,
    Hash,
    Activity,
    PieChart,
    Wifi,
    Filter,
    X,
    Printer,
    FileBarChart,
    Lock,
    Upload,
    FileText,
} from "lucide-react";

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
    getFirestore,
    collection,
    onSnapshot,
    doc,
    setDoc,
    deleteDoc,
} from "firebase/firestore";

// --- DYNAMIC CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyDW1WYymS2rFwH1gNoWyXo0T2aaFO3wa-o",
    authDomain: "payment-cycle-9f3ab.firebaseapp.com",
    projectId: "payment-cycle-9f3ab",
    storageBucket: "payment-cycle-9f3ab.firebasestorage.app",
    messagingSenderId: "137486312691",
    appId: "1:137486312691:web:33c701df338bd0b7494386",
    measurementId: "G-NMHKHHZFM2",
};

const APP_ID = "payment-cycle-production";

// Constants
const OUTLETS = ["Dha", "Jt", "Qr"];
const CURRENCY = "PKR";
const GLOBAL_WH_TAX_RATE = 0.05;

// --- HELPERS ---
const formatCurrency = (amount: any) => {
    const val = parseFloat(amount);
    if (isNaN(val)) return `${CURRENCY} 0`;
    return `${CURRENCY} ${val.toLocaleString("en-US")}`;
};

const generateCompositeId = (outlet: string, poNo: string) => {
    if (!outlet || !poNo) return "";
    const cleanPo = poNo.replace(/\//g, "_");
    return `${outlet}_${cleanPo}`;
};

const formatDisplayDate = (isoDate: string) => {
    if (!isoDate || typeof isoDate !== "string") return "";
    try {
        const parts = isoDate.split("-");
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    } catch (e) {}
    return isoDate;
};

const getPayableMonth = (invoiceDateStr: string) => {
    if (!invoiceDateStr) return "";
    const d = new Date(invoiceDateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    d.setMonth(d.getMonth() + 3);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
};

const getDisplayMonth = (isoDate: string) => {
    if (!isoDate) return "";
    const parts = isoDate.split("-");
    if (parts.length < 2) return isoDate;
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
    return date.toLocaleString("default", { month: "long", year: "numeric" });
};

const getPaymentBatch = (invoiceDateStr: string) => {
    if (!invoiceDateStr) return "N/A";
    const d = new Date(invoiceDateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "N/A";
    const day = d.getDate();
    if (day <= 15) return "Run 1";
    if (day <= 24) return "Run 2";
    return "Run 3";
};

const generateNextPoNumber = (transactions: any[], currentOutlet: string) => {
    const currentYearShort = new Date().getFullYear().toString().slice(-2);
    const prefix = `${currentYearShort}/`;
    const currentYearPos = transactions
        .filter((t) => t.outlet === currentOutlet)
        .map((t) => t.poNo)
        .filter((no) => no && typeof no === "string" && no.startsWith(prefix));

    if (currentYearPos.length === 0) return `${prefix}0001`;

    const maxNum = currentYearPos.reduce((max: number, po: string) => {
        const parts = po.split("/");
        if (parts.length < 2) return max;
        const part = parseInt(parts[1]);
        return !isNaN(part) && part > max ? part : max;
    }, 0);

    return `${prefix}${(maxNum + 1).toString().padStart(4, "0")}`;
};

const parseCSV = (text: string) => {
    const result = [];
    let row: any[] = [];
    let inQuotes = false;
    let val = "";
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    val += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                val += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ",") {
                row.push(val);
                val = "";
            } else if (char === "\n" || char === "\r") {
                row.push(val);
                val = "";
                if (row.some((c) => c.trim() !== "")) result.push(row);
                row = [];
                if (
                    char === "\r" &&
                    i + 1 < text.length &&
                    text[i + 1] === "\n"
                )
                    i++;
            } else {
                val += char;
            }
        }
    }
    if (val || row.length > 0) {
        row.push(val);
        result.push(row);
    }
    return result;
};

// --- INITIAL STATES ---
const EMPTY_PO_STATE = {
    poNo: "",
    outlet: "Dha",
    poDate: new Date().toISOString().split("T")[0],
    poAmount: "",
    dcs: [],
    invoices: [],
};
const EMPTY_INV_INPUT = {
    number: "",
    date: "",
    baseAmount: "",
    gst: "0",
    whTax: "0",
    fed: "0",
    amount: 0,
    note: "",
    isAOS: false,
};
const EMPTY_DC_INPUT = { dcNo: "", dcDate: "" };

const App = () => {
    const [activeTab, setActiveTab] = useState("entry");
    const [activeBranchTab, setActiveBranchTab] = useState("Dha");

    const [poData, setPoData] = useState<any[]>([]);
    const [paymentData, setPaymentData] = useState<any>({});
    const [dateFilter, setDateFilter] = useState({ start: "", end: "" });

    const [currentPo, setCurrentPo] = useState<any>(EMPTY_PO_STATE);
    const [stageDc, setStageDc] = useState(EMPTY_DC_INPUT);
    const [stageInv, setStageInv] = useState(EMPTY_INV_INPUT);
    const [editingPayment, setEditingPayment] = useState<any>({
        monthKey: null,
        run1: 0,
        run2: 0,
        run3: 0,
    });

    const [db, setDb] = useState<any>(null);
    const [user, setUser] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentAction, setCurrentAction] = useState("ADD");

    useEffect(() => {
        const base = parseFloat(stageInv.baseAmount as string) || 0;
        const gst = parseFloat(stageInv.gst as string) || 0;
        const fed = parseFloat(stageInv.fed as string) || 0;
        const wh = parseFloat(stageInv.whTax as string) || 0;
        const total = base + gst + wh + fed;
        setStageInv((prev) => ({ ...prev, amount: total }));
    }, [stageInv.baseAmount, stageInv.gst, stageInv.whTax, stageInv.fed]);

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
                setError(
                    "Authentication failed. Please check Firebase configuration.",
                );
                setIsLoading(false);
            }
        };
        initApp();
    }, []);

    useEffect(() => {
        if (!db || !user) return;
        const unsubPo = onSnapshot(
            collection(
                db,
                "artifacts",
                APP_ID,
                "public",
                "data",
                "purchaseOrders",
            ),
            (snapshot) => {
                const data = snapshot.docs.map((doc) => {
                    const d = doc.data();
                    return {
                        id: doc.id,
                        ...d,
                        dcs: d.dcs || [],
                        invoices: d.invoices || [],
                    };
                });
                setPoData(data);
            },
            (err: any) => setError(`Sync Error: ${err.message}`),
        );

        const unsubPayments = onSnapshot(
            collection(db, "artifacts", APP_ID, "public", "data", "payments"),
            (snapshot) => {
                const pMap: any = {};
                snapshot.docs.forEach((doc) => {
                    pMap[doc.id] = doc.data();
                });
                setPaymentData(pMap);
            },
        );

        return () => {
            unsubPo();
            unsubPayments();
        };
    }, [db, user]);

    const transactions = useMemo(() => poData, [poData]);

    const filteredTransactions = useMemo(() => {
        let result = transactions;
        if (dateFilter.start || dateFilter.end) {
            const start = dateFilter.start || "0000-01-01";
            const end = dateFilter.end || "9999-12-31";
            result = result.filter((t: any) => {
                if (t.invoices && t.invoices.length > 0)
                    return t.invoices.some(
                        (inv: any) => inv.date >= start && inv.date <= end,
                    );
                return t.poDate >= start && t.poDate <= end;
            });
        }
        return result;
    }, [transactions, dateFilter]);

    const stats = useMemo(() => {
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;
        let startFilter = dateFilter.start || `${currentMonthKey}-01`;
        let endFilter = dateFilter.end || `${currentMonthKey}-31`;
        let label = dateFilter.start ? "(Selected Range)" : "(Current Month)";

        let purchasing = 0,
            totalInv = 0,
            aosInv = 0,
            payable = 0,
            openPoValue = 0;

        transactions.forEach((t: any) => {
            if (t.poDate && t.poDate >= startFilter && t.poDate <= endFilter) {
                const hasInv =
                    t.invoices &&
                    t.invoices.length > 0 &&
                    t.invoices.some((i: any) => parseFloat(i.amount) > 0);
                if (!hasInv) openPoValue += parseFloat(t.poAmount) || 0;
            }

            t.invoices.forEach((inv: any) => {
                if (!inv.date) return;
                if (inv.date >= startFilter && inv.date <= endFilter) {
                    purchasing +=
                        parseFloat(inv.baseAmount) ||
                        parseFloat(inv.amount) ||
                        0;
                    totalInv++;
                    if (inv.isAOS) aosInv++;
                }
                const payableMonth = getPayableMonth(inv.date);
                if (
                    dateFilter.start
                        ? inv.date >= startFilter && inv.date <= endFilter
                        : payableMonth === currentMonthKey
                ) {
                    payable += parseFloat(inv.amount) || 0;
                }
            });
        });
        return {
            purchasing,
            totalInv,
            aosInv,
            payable,
            openPoValue,
            aosPerc: totalInv > 0 ? Math.round((aosInv / totalInv) * 100) : 0,
            label,
        };
    }, [transactions, dateFilter]);

    const summaryData = useMemo(() => {
        const grouping: any = {};
        transactions.forEach((t: any) => {
            t.invoices.forEach((inv: any) => {
                if (!inv.date || !inv.amount) return;
                const monthKey = getPayableMonth(inv.date);
                const batch = getPaymentBatch(inv.date);
                if (!grouping[monthKey]) {
                    grouping[monthKey] = {
                        monthKey,
                        label: getDisplayMonth(monthKey),
                        run1: 0,
                        run2: 0,
                        run3: 0,
                        Dha: 0,
                        Jt: 0,
                        Qr: 0,
                        aosTotal: 0,
                        Total: 0,
                        paidRun1: paymentData[monthKey]?.run1 || 0,
                        paidRun2: paymentData[monthKey]?.run2 || 0,
                        paidRun3: paymentData[monthKey]?.run3 || 0,
                    };
                }
                const amt = parseFloat(inv.amount) || 0;
                if (batch === "Run 1") grouping[monthKey].run1 += amt;
                else if (batch === "Run 2") grouping[monthKey].run2 += amt;
                else if (batch === "Run 3") grouping[monthKey].run3 += amt;
                if (grouping[monthKey][t.outlet] !== undefined)
                    grouping[monthKey][t.outlet] += amt;
                if (inv.isAOS) grouping[monthKey].aosTotal += amt;
                grouping[monthKey].Total += amt;
            });
        });
        Object.keys(paymentData).forEach((mKey) => {
            if (!grouping[mKey])
                grouping[mKey] = {
                    monthKey: mKey,
                    label: getDisplayMonth(mKey),
                    run1: 0,
                    run2: 0,
                    run3: 0,
                    Dha: 0,
                    Jt: 0,
                    Qr: 0,
                    aosTotal: 0,
                    Total: 0,
                    paidRun1: paymentData[mKey].run1 || 0,
                    paidRun2: paymentData[mKey].run2 || 0,
                    paidRun3: paymentData[mKey].run3 || 0,
                };
        });
        return (Object.values(grouping) as any[]).sort((a: any, b: any) =>
            a.monthKey.localeCompare(b.monthKey),
        );
    }, [transactions, paymentData]);

    const openPoList = useMemo(() => {
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;
        let start = dateFilter.start || `${currentMonthKey}-01`;
        let end = dateFilter.end || `${currentMonthKey}-31`;
        return transactions
            .filter(
                (t: any) =>
                    t.poDate >= start &&
                    t.poDate <= end &&
                    !(
                        t.invoices &&
                        t.invoices.length > 0 &&
                        t.invoices.some((i: any) => parseFloat(i.amount) > 0)
                    ),
            )
            .sort((a: any, b: any) => a.poDate.localeCompare(b.poDate));
    }, [transactions, dateFilter]);

    const handlePoLookup = () => {
        const poNo = currentPo.poNo.trim();
        if (!poNo) return;
        const existing = transactions.find(
            (t: any) => t.poNo === poNo && t.outlet === activeBranchTab,
        );
        if (existing) {
            setCurrentPo({ ...existing });
            setCurrentAction("UPDATE");
        } else {
            setCurrentAction("ADD");
        }
    };

    const handleSave = async () => {
        if (!currentPo.poNo || !db) return;
        const docId = generateCompositeId(currentPo.outlet, currentPo.poNo);
        try {
            await setDoc(
                doc(
                    db,
                    "artifacts",
                    APP_ID,
                    "public",
                    "data",
                    "purchaseOrders",
                    docId,
                ),
                {
                    ...currentPo,
                    lastUpdated: new Date().toISOString(),
                    status:
                        currentPo.invoices.length > 0 ? "Invoiced" : "Pending",
                },
            );
            setCurrentPo({ ...EMPTY_PO_STATE, outlet: activeBranchTab });
            setStageDc(EMPTY_DC_INPUT);
            setStageInv(EMPTY_INV_INPUT);
            setCurrentAction("ADD");
            setError("Record Saved Successfully!");
            setTimeout(() => setError(null), 3000);
        } catch (e: any) {
            setError(`Save failed: ${e.message}`);
        }
    };

    const handleDelete = async (id: string) => {
        if (!db) return;
        try {
            await deleteDoc(
                doc(
                    db,
                    "artifacts",
                    APP_ID,
                    "public",
                    "data",
                    "purchaseOrders",
                    id,
                ),
            );
        } catch (e: any) {
            setError("Delete failed.");
        }
    };

    const handleImportCSV = (e: any) => {
        const file = e.target.files[0];
        if (!file || !db) return;
        setIsLoading(true);
        const reader = new FileReader();
        reader.onload = async (ev: any) => {
            try {
                const rows = parseCSV(ev.target.result);
                if (rows.length < 2) throw new Error("Invalid CSV format.");
                const headers = rows[0].map((h: string) => h.trim());
                const poMap: any = {};

                rows.slice(1).forEach((row) => {
                    const poNoIdx = headers.indexOf("PO #");
                    const outletIdx = headers.indexOf("Outlet");
                    if (poNoIdx === -1 || outletIdx === -1) return;
                    const poNo = (row[poNoIdx] || "").trim();
                    const outlet = (row[outletIdx] || "").trim();
                    if (!poNo || !outlet) return;

                    const id = generateCompositeId(outlet, poNo);
                    if (!poMap[id]) {
                        const poDateIdx = headers.indexOf("PO Date");
                        const estIdx = headers.indexOf("Estimated Amount");
                        const poEstIdx = headers.indexOf("PO Amount (Est)");
                        poMap[id] = {
                            poNo,
                            outlet,
                            poDate:
                                poDateIdx !== -1
                                    ? (row[poDateIdx] || "").trim()
                                    : "",
                            poAmount: parseFloat(
                                (estIdx !== -1
                                    ? row[estIdx]
                                    : poEstIdx !== -1
                                      ? row[poEstIdx]
                                      : "0") || "0",
                            ),
                            dcs: [],
                            invoices: [],
                        };
                    }

                    // DC logic
                    const dcNoIdx = headers.indexOf("DC #");
                    if (dcNoIdx !== -1 && row[dcNoIdx]) {
                        const dNos = row[dcNoIdx]
                            .split(";")
                            .map((s: string) => s.trim())
                            .filter(Boolean);
                        const dDatesIdx = headers.indexOf("DC Date");
                        const dDates =
                            dDatesIdx !== -1
                                ? (row[dDatesIdx] || "")
                                      .split(";")
                                      .map((s: string) => s.trim())
                                : [];
                        dNos.forEach((n: string, i: number) => {
                            if (!poMap[id].dcs.some((d: any) => d.dcNo === n)) {
                                poMap[id].dcs.push({
                                    id: Math.random().toString(),
                                    dcNo: n,
                                    dcDate: dDates[i] || "",
                                });
                            }
                        });
                    }

                    // Inv logic
                    const invNoIdx = headers.indexOf("Inv #");
                    if (invNoIdx !== -1 && row[invNoIdx]) {
                        const totalIdx = headers.indexOf("Total");
                        if (
                            row[invNoIdx] &&
                            !poMap[id].invoices.some(
                                (i: any) => i.number === row[invNoIdx],
                            )
                        ) {
                            const invDateIdx = headers.indexOf("Inv Date");
                            const baseIdx = headers.indexOf("Base Amt");
                            const gstIdx = headers.indexOf("GST");
                            const whIdx = headers.indexOf("WH");
                            const fedIdx = headers.indexOf("FED");
                            const aosIdx = headers.indexOf("AOS Type");
                            const noteIdx = headers.indexOf("Note");

                            poMap[id].invoices.push({
                                id: Math.random().toString(),
                                number: row[invNoIdx],
                                date:
                                    invDateIdx !== -1
                                        ? row[invDateIdx] || ""
                                        : "",
                                baseAmount:
                                    baseIdx !== -1
                                        ? parseFloat(row[baseIdx] || "0")
                                        : 0,
                                gst:
                                    gstIdx !== -1
                                        ? parseFloat(row[gstIdx] || "0")
                                        : 0,
                                whTax:
                                    whIdx !== -1
                                        ? parseFloat(row[whIdx] || "0")
                                        : 0,
                                fed:
                                    fedIdx !== -1
                                        ? parseFloat(row[fedIdx] || "0")
                                        : 0,
                                amount:
                                    totalIdx !== -1
                                        ? parseFloat(row[totalIdx] || "0")
                                        : 0,
                                isAOS:
                                    aosIdx !== -1
                                        ? (row[aosIdx] || "").toLowerCase() ===
                                          "yes"
                                        : false,
                                note: noteIdx !== -1 ? row[noteIdx] || "" : "",
                            });
                        }
                    }
                });
                await Promise.all(
                    Object.entries(poMap).map(([id, data]: any) => {
                        data.status =
                            data.invoices && data.invoices.length > 0
                                ? "Invoiced"
                                : "Pending";
                        return setDoc(
                            doc(
                                db,
                                "artifacts",
                                APP_ID,
                                "public",
                                "data",
                                "purchaseOrders",
                                id,
                            ),
                            data,
                            { merge: true },
                        );
                    }),
                );
                setError("Import Success!");
                setTimeout(() => setError(null), 3000);
            } catch (err: any) {
                setError("Import failed: " + err.message);
            } finally {
                setIsLoading(false);
                e.target.value = null;
            }
        };
        reader.readAsText(file);
    };

    const downloadCSV = () => {
        const headers = [
            "PO #",
            "Outlet",
            "PO Date",
            "PO Amount (Est)",
            "DC #",
            "DC Date",
            "Inv #",
            "Inv Date",
            "Base Amt",
            "GST",
            "WH",
            "FED",
            "Total",
            "AOS Type",
            "Note",
            "Payable Month (N+3)",
            "Batch Run",
            "Status",
        ];
        let rows = [headers.join(",")];
        const dataToExport =
            activeTab === "entry"
                ? transactions.filter((t: any) => t.outlet === activeBranchTab)
                : transactions;
        dataToExport.forEach((t: any) => {
            if (t.invoices && t.invoices.length > 0) {
                t.invoices.forEach((inv: any) => {
                    rows.push(
                        [
                            `"${t.poNo}"`,
                            t.outlet,
                            formatDisplayDate(t.poDate),
                            t.poAmount || 0,
                            (t.dcs || []).map((d: any) => d.dcNo).join("; "),
                            (t.dcs || [])
                                .map((d: any) => formatDisplayDate(d.dcDate))
                                .join("; "),
                            `"${inv.number || ""}"`,
                            formatDisplayDate(inv.date),
                            inv.baseAmount,
                            inv.gst,
                            inv.whTax,
                            inv.fed,
                            inv.amount,
                            inv.isAOS ? "Yes" : "No",
                            `"${inv.note || ""}"`,
                            `"${getDisplayMonth(getPayableMonth(inv.date))}"`,
                            getPaymentBatch(inv.date),
                            t.status,
                        ].join(","),
                    );
                });
            } else {
                rows.push(
                    [
                        `"${t.poNo}"`,
                        t.outlet,
                        formatDisplayDate(t.poDate),
                        t.poAmount || 0,
                        (t.dcs || []).map((d: any) => d.dcNo).join("; "),
                        (t.dcs || [])
                            .map((d: any) => formatDisplayDate(d.dcDate))
                            .join("; "),
                        "",
                        "",
                        0,
                        0,
                        0,
                        0,
                        0,
                        "",
                        "",
                        "",
                        "",
                        t.status,
                    ].join(","),
                );
            }
        });
        const blob = new Blob([rows.join("\n")], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `P2P_Export_${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
    };

    const downloadOpenPoReport = () => {
        if (openPoList.length === 0) return;
        const headers = [
            "PO #",
            "Outlet",
            "PO Date",
            "Estimated Amount",
            "Status",
        ];
        const rows = [headers.join(",")];
        openPoList.forEach((t: any) =>
            rows.push(
                [
                    `"${t.poNo}"`,
                    t.outlet,
                    t.poDate,
                    t.poAmount || 0,
                    "Open",
                ].join(","),
            ),
        );
        const blob = new Blob([rows.join("\n")], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `OpenPO_Report_${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
    };

    if (isLoading)
        return (
            <div className="p-10 text-center font-bold text-blue-600">
                Syncing with Cloud...
            </div>
        );

    return (
        <div className="max-w-7xl mx-auto bg-gray-50 min-h-screen p-4 font-sans text-gray-800">
            <div className="bg-slate-900 text-white p-6 rounded-t-xl shadow-lg mb-6 flex flex-col md:flex-row justify-between items-center gap-4 print:hidden">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <DollarSign /> P2P Cloud Manager
                    </h1>
                    <p className="text-[10px] text-slate-400 font-mono">
                        DB: {APP_ID}
                    </p>
                </div>
                <div className="flex items-center gap-2 bg-slate-800 p-1.5 rounded border border-slate-700">
                    <Filter size={14} className="text-slate-400 ml-1" />
                    <input
                        type="date"
                        value={dateFilter.start}
                        onChange={(e) =>
                            setDateFilter({
                                ...dateFilter,
                                start: e.target.value,
                            })
                        }
                        className="bg-transparent text-white text-xs outline-none w-24"
                    />
                    <span className="text-slate-500">-</span>
                    <input
                        type="date"
                        value={dateFilter.end}
                        onChange={(e) =>
                            setDateFilter({
                                ...dateFilter,
                                end: e.target.value,
                            })
                        }
                        className="bg-transparent text-white text-xs outline-none w-24"
                    />
                    {(dateFilter.start || dateFilter.end) && (
                        <button
                            onClick={() =>
                                setDateFilter({ start: "", end: "" })
                            }
                            className="text-red-400 p-1"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
                <div className="flex gap-2">
                    <input
                        type="file"
                        accept=".csv"
                        id="csv-up"
                        className="hidden"
                        onChange={handleImportCSV}
                    />
                    <label
                        htmlFor="csv-up"
                        className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 cursor-pointer transition-colors"
                    >
                        <Upload size={14} /> Import
                    </label>
                    <button
                        onClick={downloadCSV}
                        className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 transition-colors"
                    >
                        <Download size={14} /> Export
                    </button>
                    <button
                        onClick={() => {
                            setCurrentPo({
                                ...EMPTY_PO_STATE,
                                outlet: activeBranchTab,
                            });
                            setCurrentAction("ADD");
                        }}
                        className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 transition-colors"
                    >
                        <RefreshCw size={14} /> Reset
                    </button>
                </div>
            </div>

            {error && (
                <div
                    className={`p-3 rounded mb-4 text-sm font-semibold border-l-4 ${error.includes("Success") ? "bg-green-100 text-green-800 border-green-500" : "bg-yellow-100 text-yellow-800 border-yellow-500"}`}
                >
                    {error}
                </div>
            )}

            <div className="flex gap-2 mb-6 border-b border-gray-200 print:hidden">
                {["entry", "summary", "reconcile", "reports"].map((t, idx) => (
                    <button
                        key={t}
                        onClick={() => setActiveTab(t)}
                        className={`px-4 py-2 font-bold text-sm rounded-t-lg transition-colors ${activeTab === t ? "bg-white text-blue-600 border-t border-x" : "text-gray-500 hover:bg-gray-100"}`}
                    >
                        {idx + 1}. {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            {activeTab === "entry" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-12 mb-2 flex gap-1">
                        {OUTLETS.map((o) => (
                            <button
                                key={o}
                                onClick={() => {
                                    setActiveBranchTab(o);
                                    setCurrentPo({
                                        ...EMPTY_PO_STATE,
                                        outlet: o,
                                    });
                                    setCurrentAction("ADD");
                                }}
                                className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${activeBranchTab === o ? "bg-slate-800 text-white shadow-md" : "bg-white text-slate-500 hover:bg-slate-100"}`}
                            >
                                {o} Branch
                            </button>
                        ))}
                    </div>
                    <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
                        <div className="bg-amber-50 p-4 rounded-lg border-l-4 border-amber-500 flex items-center justify-between shadow-sm">
                            <div>
                                <p className="text-xs font-bold text-amber-500 uppercase">
                                    Open PO {stats.label}
                                </p>
                                <p className="text-xl font-extrabold text-amber-900 mt-1">
                                    {formatCurrency(stats.openPoValue)}
                                </p>
                            </div>
                            <FileText className="text-amber-200 w-8 h-8" />
                        </div>
                        <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500 flex items-center justify-between shadow-sm">
                            <div>
                                <p className="text-xs font-bold text-blue-400 uppercase">
                                    Purchase {stats.label}
                                </p>
                                <p className="text-xl font-extrabold text-blue-900 mt-1">
                                    {formatCurrency(stats.purchasing)}
                                </p>
                            </div>
                            <Activity className="text-blue-200 w-8 h-8" />
                        </div>
                        <div className="bg-indigo-50 p-4 rounded-lg border-l-4 border-indigo-500 flex items-center justify-between shadow-sm">
                            <div>
                                <p className="text-xs font-bold text-indigo-400 uppercase">
                                    AOS Type {stats.label}
                                </p>
                                <p className="text-xl font-extrabold text-indigo-900 mt-1">
                                    {stats.aosPerc}%
                                </p>
                            </div>
                            <PieChart className="text-indigo-200 w-8 h-8" />
                        </div>
                        <div className="bg-green-50 p-4 rounded-lg border-l-4 border-green-500 flex items-center justify-between shadow-sm">
                            <div>
                                <p className="text-xs font-bold text-green-500 uppercase">
                                    DUE {stats.label}
                                </p>
                                <p className="text-xl font-extrabold text-green-900 mt-1">
                                    {formatCurrency(stats.payable)}
                                </p>
                            </div>
                            <DollarSign className="text-green-200 w-8 h-8" />
                        </div>
                    </div>

                    <div className="lg:col-span-5 space-y-4">
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-blue-100">
                            <h3 className="text-sm font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
                                <Hash size={16} /> PO Master ({activeBranchTab})
                            </h3>
                            <div className="mb-4">
                                <label className="text-xs font-bold text-gray-400 uppercase">
                                    PO Number
                                </label>
                                <div className="flex gap-2 mt-1">
                                    <input
                                        type="text"
                                        value={currentPo.poNo}
                                        onChange={(e) =>
                                            setCurrentPo({
                                                ...currentPo,
                                                poNo: e.target.value,
                                            })
                                        }
                                        onBlur={handlePoLookup}
                                        onKeyDown={(e) =>
                                            e.key === "Enter" &&
                                            handlePoLookup()
                                        }
                                        className="flex-1 p-2 border-2 border-blue-200 rounded font-mono font-bold outline-none focus:border-blue-500"
                                        disabled={currentAction === "UPDATE"}
                                    />
                                    {currentAction === "ADD" && (
                                        <button
                                            onClick={() =>
                                                setCurrentPo({
                                                    ...currentPo,
                                                    poNo: generateNextPoNumber(
                                                        transactions,
                                                        activeBranchTab,
                                                    ),
                                                })
                                            }
                                            className="bg-blue-100 text-blue-700 px-3 rounded text-xs font-bold hover:bg-blue-200"
                                        >
                                            Auto
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-gray-400 uppercase">
                                        Outlet
                                    </label>
                                    <select
                                        value={activeBranchTab}
                                        disabled
                                        className="w-full p-2 mt-1 border rounded bg-gray-100"
                                    >
                                        <option value={activeBranchTab}>
                                            {activeBranchTab}
                                        </option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-400 uppercase">
                                        PO Date
                                    </label>
                                    <input
                                        type="date"
                                        value={currentPo.poDate}
                                        onChange={(e) =>
                                            setCurrentPo({
                                                ...currentPo,
                                                poDate: e.target.value,
                                            })
                                        }
                                        className="w-full p-2 mt-1 border rounded outline-none focus:border-blue-500"
                                        disabled={currentAction === "UPDATE"}
                                    />
                                </div>
                            </div>
                            <div className="mt-3">
                                <label className="text-xs font-bold text-amber-600 uppercase">
                                    PO Amount (Est.)
                                </label>
                                <input
                                    type="number"
                                    value={currentPo.poAmount}
                                    onChange={(e) =>
                                        setCurrentPo({
                                            ...currentPo,
                                            poAmount: e.target.value,
                                        })
                                    }
                                    className="w-full p-2 mt-1 border rounded font-bold text-amber-700 outline-none focus:border-amber-500"
                                    placeholder="0.00"
                                    disabled={currentAction === "UPDATE"}
                                />
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-lg shadow-sm border border-orange-100 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-orange-400"></div>
                            <h3 className="text-sm font-bold text-slate-500 uppercase mb-3">
                                Delivery Challans
                            </h3>
                            <div className="flex gap-2 mb-3 items-end bg-orange-50 p-3 rounded">
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                                        DC #
                                    </label>
                                    <input
                                        type="text"
                                        value={stageDc.dcNo}
                                        onChange={(e) =>
                                            setStageDc({
                                                ...stageDc,
                                                dcNo: e.target.value,
                                            })
                                        }
                                        className="w-full p-1 border rounded text-sm focus:border-orange-500 outline-none"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                                        Date
                                    </label>
                                    <input
                                        type="date"
                                        value={stageDc.dcDate}
                                        onChange={(e) =>
                                            setStageDc({
                                                ...stageDc,
                                                dcDate: e.target.value,
                                            })
                                        }
                                        className="w-full p-1 border rounded text-sm focus:border-orange-500 outline-none"
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        if (!stageDc.dcNo || !stageDc.dcDate)
                                            return;
                                        setCurrentPo({
                                            ...currentPo,
                                            dcs: [
                                                ...currentPo.dcs,
                                                {
                                                    ...stageDc,
                                                    id: Date.now().toString(),
                                                },
                                            ],
                                        });
                                        setStageDc(EMPTY_DC_INPUT);
                                    }}
                                    className="bg-orange-500 text-white p-1.5 rounded hover:bg-orange-600"
                                >
                                    <Plus size={16} />
                                </button>
                            </div>
                            <div className="space-y-1 max-h-24 overflow-y-auto">
                                {currentPo.dcs.map((dc: any) => (
                                    <div
                                        key={dc.id}
                                        className="flex justify-between items-center text-xs p-1.5 bg-gray-50 rounded border-l-2 border-orange-300"
                                    >
                                        <span>
                                            {dc.dcNo} |{" "}
                                            {formatDisplayDate(dc.dcDate)}
                                        </span>
                                        {currentAction === "ADD" && (
                                            <button
                                                onClick={() =>
                                                    setCurrentPo({
                                                        ...currentPo,
                                                        dcs: currentPo.dcs.filter(
                                                            (d: any) =>
                                                                d.id !== dc.id,
                                                        ),
                                                    })
                                                }
                                                className="text-red-400 hover:text-red-600"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-lg shadow-sm border border-green-100 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                            <h3 className="text-sm font-bold text-slate-500 uppercase mb-3 text-green-700">
                                Invoice Items
                            </h3>
                            <div className="bg-green-50 p-3 rounded mb-3 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase">
                                            Inv #
                                        </label>
                                        <input
                                            type="text"
                                            value={stageInv.number}
                                            onChange={(e) =>
                                                setStageInv({
                                                    ...stageInv,
                                                    number: e.target.value,
                                                })
                                            }
                                            className="w-full p-1 border rounded text-xs focus:border-green-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase">
                                            Date
                                        </label>
                                        <input
                                            type="date"
                                            value={stageInv.date}
                                            onChange={(e) =>
                                                setStageInv({
                                                    ...stageInv,
                                                    date: e.target.value,
                                                })
                                            }
                                            className="w-full p-1 border rounded text-xs focus:border-green-500 outline-none"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] font-bold text-blue-600 uppercase">
                                            Base Amt
                                        </label>
                                        <input
                                            type="number"
                                            value={stageInv.baseAmount}
                                            onChange={(e) =>
                                                setStageInv({
                                                    ...stageInv,
                                                    baseAmount: e.target.value,
                                                })
                                            }
                                            className="w-full p-1 border border-blue-200 rounded text-xs font-bold focus:border-green-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase">
                                            G.S.T
                                        </label>
                                        <input
                                            type="number"
                                            value={stageInv.gst}
                                            onChange={(e) =>
                                                setStageInv({
                                                    ...stageInv,
                                                    gst: e.target.value,
                                                })
                                            }
                                            className="w-full p-1 border rounded text-xs focus:border-green-500 outline-none"
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-1">
                                    <div>
                                        <label className="text-[9px] font-bold text-green-700 uppercase">
                                            Payable
                                        </label>
                                        <div className="text-md font-black text-green-800">
                                            {formatCurrency(stageInv.amount)}
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <label className="flex items-center text-[10px] text-gray-600 cursor-pointer mb-1">
                                            <input
                                                type="checkbox"
                                                checked={stageInv.isAOS}
                                                onChange={(e) =>
                                                    setStageInv({
                                                        ...stageInv,
                                                        isAOS: e.target.checked,
                                                    })
                                                }
                                                className="mr-1"
                                            />{" "}
                                            AOS
                                        </label>
                                        <button
                                            onClick={() => {
                                                if (
                                                    !stageInv.baseAmount ||
                                                    !stageInv.date
                                                )
                                                    return;
                                                setCurrentPo({
                                                    ...currentPo,
                                                    invoices: [
                                                        ...currentPo.invoices,
                                                        {
                                                            ...stageInv,
                                                            id: Date.now().toString(),
                                                            baseAmount:
                                                                parseFloat(
                                                                    stageInv.baseAmount as string,
                                                                ) || 0,
                                                            amount:
                                                                parseFloat(
                                                                    stageInv.amount as any,
                                                                ) || 0,
                                                        },
                                                    ],
                                                });
                                                setStageInv(EMPTY_INV_INPUT);
                                            }}
                                            className="bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-green-700 transition-colors"
                                        >
                                            + Add
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-1 max-h-24 overflow-y-auto">
                                {currentPo.invoices.map((inv: any) => (
                                    <div
                                        key={inv.id}
                                        className="flex justify-between items-center text-xs p-1.5 bg-gray-50 rounded border-l-2 border-orange-300"
                                    >
                                        <div>
                                            <div className="font-bold text-green-800">
                                                {formatCurrency(inv.amount)}
                                            </div>
                                            <div className="text-[9px] text-gray-400">
                                                #{inv.number}{" "}
                                                {inv.isAOS && "(AOS)"}
                                            </div>
                                        </div>
                                        {currentAction === "ADD" && (
                                            <button
                                                onClick={() =>
                                                    setCurrentPo({
                                                        ...currentPo,
                                                        invoices:
                                                            currentPo.invoices.filter(
                                                                (i: any) =>
                                                                    i.id !==
                                                                    inv.id,
                                                            ),
                                                    })
                                                }
                                                className="text-red-400 hover:text-red-600"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <button
                            onClick={handleSave}
                            disabled={!currentPo.poNo}
                            className="w-full bg-slate-800 text-white py-3 rounded-lg shadow font-bold disabled:bg-gray-300 transition-colors hover:bg-slate-700"
                        >
                            <Save size={18} className="inline mr-2" /> Save
                            Records
                        </button>
                    </div>

                    <div className="lg:col-span-7">
                        <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-gray-200">
                            <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                                <h3 className="font-bold">
                                    Journal ({activeBranchTab})
                                </h3>
                            </div>
                            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-100 text-xs text-gray-500 uppercase sticky top-0">
                                        <tr>
                                            <th className="p-3">PO #</th>
                                            <th className="p-3">Date</th>
                                            <th className="p-3">Summary</th>
                                            <th className="p-3 text-center">
                                                Action
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {filteredTransactions
                                            .filter(
                                                (t: any) =>
                                                    t.outlet ===
                                                    activeBranchTab,
                                            )
                                            .sort((a: any, b: any) =>
                                                b.poNo.localeCompare(a.poNo),
                                            )
                                            .map((t: any) => (
                                                <tr
                                                    key={t.id}
                                                    className="hover:bg-blue-50 transition cursor-default group"
                                                >
                                                    <td className="p-3 font-mono font-bold text-blue-600">
                                                        {t.poNo}
                                                    </td>
                                                    <td className="p-3 text-xs text-gray-400">
                                                        {formatDisplayDate(
                                                            t.poDate,
                                                        )}
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="flex gap-4">
                                                            <div className="text-xs font-bold text-orange-600">
                                                                {t.dcs.length}{" "}
                                                                DCs
                                                            </div>
                                                            <div className="text-xs font-bold text-green-600">
                                                                {
                                                                    t.invoices
                                                                        .length
                                                                }{" "}
                                                                Invoices (
                                                                {formatCurrency(
                                                                    t.invoices.reduce(
                                                                        (
                                                                            s: number,
                                                                            i: any,
                                                                        ) =>
                                                                            s +
                                                                            i.amount,
                                                                        0,
                                                                    ),
                                                                )}
                                                                )
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <button
                                                            onClick={() =>
                                                                handleDelete(
                                                                    t.id,
                                                                )
                                                            }
                                                            className="text-gray-300 hover:text-red-500 transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === "summary" && (
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
                    <h2 className="text-xl font-bold mb-4">
                        Outflow Projection
                    </h2>
                    <table className="w-full text-sm border-collapse whitespace-nowrap">
                        <thead>
                            <tr className="bg-slate-800 text-white text-xs uppercase">
                                <th className="p-3 text-left">Month (N+3)</th>
                                <th className="p-3 text-right">Run 1</th>
                                <th className="p-3 text-right">Run 2</th>
                                <th className="p-3 text-right">Run 3</th>
                                {OUTLETS.map((o) => (
                                    <th key={o} className="p-3 text-right">
                                        {o}
                                    </th>
                                ))}
                                <th className="p-3 text-right bg-green-700">
                                    Total
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaryData.map((row: any) => (
                                <tr
                                    key={row.monthKey}
                                    className="border-b hover:bg-gray-50"
                                >
                                    <td className="p-3 font-bold">
                                        {row.label}
                                    </td>
                                    <td className="p-3 text-right text-blue-700 font-mono">
                                        {formatCurrency(row.run1)}
                                    </td>
                                    <td className="p-3 text-right text-blue-700 font-mono">
                                        {formatCurrency(row.run2)}
                                    </td>
                                    <td className="p-3 text-right text-blue-700 font-mono">
                                        {formatCurrency(row.run3)}
                                    </td>
                                    {OUTLETS.map((o) => (
                                        <td
                                            key={o}
                                            className="p-3 text-right text-gray-500 font-mono"
                                        >
                                            {formatCurrency(row[o])}
                                        </td>
                                    ))}
                                    <td className="p-3 text-right font-bold text-green-800 bg-green-50 font-mono">
                                        {formatCurrency(row.Total)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === "reconcile" && (
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
                    <h2 className="text-xl font-bold mb-4">
                        Payment Reconciliation
                    </h2>
                    <table className="w-full text-sm border-collapse whitespace-nowrap">
                        <thead>
                            <tr className="bg-slate-800 text-white text-xs uppercase">
                                <th className="p-3 text-left">Month</th>
                                <th className="p-3 text-right">Accrued</th>
                                <th className="p-3 text-right">Run 1 Paid</th>
                                <th className="p-3 text-right">Run 2 Paid</th>
                                <th className="p-3 text-right">Run 3 Paid</th>
                                <th className="p-3 text-right">Balance</th>
                                <th className="p-3 text-center">Edit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaryData.map((row: any) => {
                                const totalPaid =
                                    (row.paidRun1 || 0) +
                                    (row.paidRun2 || 0) +
                                    (row.paidRun3 || 0);
                                const bal = row.Total - totalPaid;
                                const isEditing =
                                    editingPayment.monthKey === row.monthKey;
                                return (
                                    <tr
                                        key={row.monthKey}
                                        className="border-b hover:bg-gray-50 transition-colors"
                                    >
                                        <td className="p-3 font-bold">
                                            {row.label}
                                        </td>
                                        <td className="p-3 text-right font-bold text-emerald-800 font-mono">
                                            {formatCurrency(row.Total)}
                                        </td>
                                        <td className="p-3 text-right font-mono">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    value={editingPayment.run1}
                                                    onChange={(e) =>
                                                        setEditingPayment({
                                                            ...editingPayment,
                                                            run1: e.target
                                                                .value,
                                                        })
                                                    }
                                                    className="border rounded p-1 w-20 text-right text-xs"
                                                />
                                            ) : (
                                                formatCurrency(row.paidRun1)
                                            )}
                                        </td>
                                        <td className="p-3 text-right font-mono">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    value={editingPayment.run2}
                                                    onChange={(e) =>
                                                        setEditingPayment({
                                                            ...editingPayment,
                                                            run2: e.target
                                                                .value,
                                                        })
                                                    }
                                                    className="border rounded p-1 w-20 text-right text-xs"
                                                />
                                            ) : (
                                                formatCurrency(row.paidRun2)
                                            )}
                                        </td>
                                        <td className="p-3 text-right font-mono">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    value={editingPayment.run3}
                                                    onChange={(e) =>
                                                        setEditingPayment({
                                                            ...editingPayment,
                                                            run3: e.target
                                                                .value,
                                                        })
                                                    }
                                                    className="border rounded p-1 w-20 text-right text-xs"
                                                />
                                            ) : (
                                                formatCurrency(row.paidRun3)
                                            )}
                                        </td>
                                        <td
                                            className={`p-3 text-right font-bold font-mono ${bal > 0 ? "text-red-600" : "text-emerald-600"}`}
                                        >
                                            {formatCurrency(bal)}
                                        </td>
                                        <td className="p-3 text-center">
                                            {isEditing ? (
                                                <div className="flex gap-1 justify-center">
                                                    <button
                                                        onClick={async () => {
                                                            try {
                                                                await setDoc(
                                                                    doc(
                                                                        db,
                                                                        "artifacts",
                                                                        APP_ID,
                                                                        "public",
                                                                        "data",
                                                                        "payments",
                                                                        row.monthKey,
                                                                    ),
                                                                    {
                                                                        run1:
                                                                            parseFloat(
                                                                                editingPayment.run1,
                                                                            ) ||
                                                                            0,
                                                                        run2:
                                                                            parseFloat(
                                                                                editingPayment.run2,
                                                                            ) ||
                                                                            0,
                                                                        run3:
                                                                            parseFloat(
                                                                                editingPayment.run3,
                                                                            ) ||
                                                                            0,
                                                                    },
                                                                    {
                                                                        merge: true,
                                                                    },
                                                                );
                                                                setEditingPayment(
                                                                    {
                                                                        monthKey:
                                                                            null,
                                                                    },
                                                                );
                                                            } catch (err: any) {
                                                                setError(
                                                                    "Payment save failed: " +
                                                                        err.message,
                                                                );
                                                            }
                                                        }}
                                                        className="bg-green-600 text-white px-2 py-1 rounded text-xs shadow-sm hover:bg-green-700 transition-colors"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            setEditingPayment({
                                                                monthKey: null,
                                                            })
                                                        }
                                                        className="bg-gray-400 text-white px-2 py-1 rounded text-xs hover:bg-gray-500 transition-colors"
                                                    >
                                                        X
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() =>
                                                        setEditingPayment({
                                                            monthKey:
                                                                row.monthKey,
                                                            run1: row.paidRun1,
                                                            run2: row.paidRun2,
                                                            run3: row.paidRun3,
                                                        })
                                                    }
                                                    className="bg-slate-700 text-white px-3 py-1 rounded text-xs shadow-sm hover:bg-slate-800 transition-colors"
                                                >
                                                    Edit
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === "reports" && (
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">
                            Open Purchase Orders
                        </h2>
                        <div className="flex gap-2">
                            <button
                                onClick={downloadOpenPoReport}
                                className="bg-amber-600 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 hover:bg-amber-500 transition-colors"
                            >
                                <Download size={14} /> CSV
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="bg-slate-800 text-white text-xs uppercase">
                                    <th className="p-3 text-left">PO #</th>
                                    <th className="p-3 text-left">Outlet</th>
                                    <th className="p-3 text-left">PO Date</th>
                                    <th className="p-3 text-right">
                                        Est Amount
                                    </th>
                                    <th className="p-3 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {openPoList.map((t: any, i: number) => (
                                    <tr
                                        key={i}
                                        className="border-b hover:bg-gray-50 transition-colors"
                                    >
                                        <td className="p-3 font-mono font-bold text-blue-700">
                                            {t.poNo}
                                        </td>
                                        <td className="p-3 font-bold text-slate-600">
                                            {t.outlet}
                                        </td>
                                        <td className="p-3 text-slate-500">
                                            {formatDisplayDate(t.poDate)}
                                        </td>
                                        <td className="p-3 text-right font-bold text-amber-700 font-mono">
                                            {formatCurrency(t.poAmount)}
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-[10px] font-bold uppercase">
                                                Open
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {openPoList.length > 0 && (
                                    <tr className="bg-amber-50 font-bold border-t-2 border-amber-200">
                                        <td
                                            colSpan={3}
                                            className="p-3 text-right uppercase text-amber-800"
                                        >
                                            Total Open Value:
                                        </td>
                                        <td className="p-3 text-right font-mono text-amber-900 text-lg">
                                            {formatCurrency(
                                                openPoList.reduce(
                                                    (s: number, t: any) =>
                                                        s +
                                                        (parseFloat(
                                                            t.poAmount,
                                                        ) || 0),
                                                    0,
                                                ),
                                            )}
                                        </td>
                                        <td></td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="fixed bottom-0 left-0 w-full bg-slate-800 text-white text-[10px] p-1 px-4 flex justify-between items-center z-50 opacity-90 print:hidden">
                <div className="flex gap-4">
                    <span className="flex items-center gap-1 text-green-400 font-bold">
                        <Wifi size={10} /> Live Cloud Connection
                    </span>
                    <span>Records: {transactions.length}</span>
                </div>
                <div className="text-slate-500 font-mono">Ledger: {APP_ID}</div>
            </div>
        </div>
    );
};

export default App;
