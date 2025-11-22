import React, { useState, useEffect, useCallback, useMemo } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  LucidePlus,
  LucideTarget,
  LucideCopy,
  LucideCheckCircle,
  LucideAlertTriangle,
  LucideLoader,
  LucideX,
  LucideCamera,
  LucideFlame,
  LucideDrumstick,
  LucidePizza,
  LucideWheat,
  LucideCalendar,
  LucideArrowLeft,
  LucideHistory,
} from "lucide-react";

// --- 全局變量 ---
const appId = "nutritrack-mobile";
const firebaseConfig = {
  apiKey: "AIzaSyCu02zo17EDVCl0zTqz3Sc3fhfkpGJCHk0",
  authDomain: "nutritrack-21b55.firebaseapp.com",
  projectId: "nutritrack-21b55",
  storageBucket: "nutritrack-21b55.firebasestorage.app",
  messagingSenderId: "605701087586",
  appId: "1:605701087586:web:847dd05f4f61da2948cc3b",
  measurementId: "G-6TLMZG21JT",
};
const initialAuthToken =
  typeof __initial_auth_token !== "undefined" ? __initial_auth_token : null;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=`;

// --- 介面組件 ---

const NutrientCard = ({ label, value, unit, color, icon }) => {
  const textColor = `text-${color}-700`;
  const iconColor = `text-${color}-600`;
  return (
    <div
      className={`flex flex-col justify-between items-start p-5 w-full sm:w-[calc(50%-8px)] md:w-[calc(25%-8px)] rounded-2xl bg-white shadow-lg border border-gray-100 transform hover:shadow-xl transition duration-300 m-1 md:m-2`}
    >
      <div className={`flex items-center justify-between w-full mb-3`}>
        <p className="text-xs font-semibold text-gray-500 uppercase">{label}</p>
        <div
          className={`p-2 rounded-full ${iconColor} bg-${color}-50 shadow-md`}
        >
          {icon}
        </div>
      </div>
      <div className="flex flex-col">
        <span className={`text-3xl font-extrabold ${textColor}`}>
          {Math.round(value)}
        </span>
        <span className="text-base font-semibold text-gray-400">{unit}</span>
      </div>
    </div>
  );
};

async function fetchWithRetry(url, options, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      return response;
    } catch (error) {
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("API request failed after multiple retries.");
}

const formatDate = (date) => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const targetDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const todayDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const yesterdayDate = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate()
  );

  if (targetDate.getTime() === todayDate.getTime()) return "今天";
  if (targetDate.getTime() === yesterdayDate.getTime()) return "昨天";
  return date.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const getLocalDateString = (date) => {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().split("T")[0];
};

// --- Main App Component ---
export default function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [currentView, setCurrentView] = useState("dashboard");
  const [logs, setLogs] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [foodInput, setFoodInput] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null);

  const [historyDate, setHistoryDate] = useState(
    getLocalDateString(new Date())
  );
  const [imageFile, setImageFile] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState([]);

  // Inject iOS Web App Meta Tags
  useEffect(() => {
    const metaTags = [
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      }, // Prevent zooming
    ];

    metaTags.forEach((tagInfo) => {
      let tag = document.querySelector(`meta[name="${tagInfo.name}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.name = tagInfo.name;
        document.head.appendChild(tag);
      }
      tag.content = tagInfo.content;
    });

    document.title = "NutriTrack";
  }, []);

  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);
      setDb(firestore);
      setAuth(firebaseAuth);
      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (!user) {
          if (initialAuthToken) {
            try {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } catch (e) {
              await signInAnonymously(firebaseAuth);
            }
          } else {
            await signInAnonymously(firebaseAuth);
          }
        }
        const currentUser = firebaseAuth.currentUser;
        if (currentUser) setUserId(currentUser.uid);
        else setUserId(crypto.randomUUID());
        setIsAuthReady(true);
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("Firebase init failed:", e);
      setIsAuthReady(true);
    }
  }, []);

  useEffect(() => {
    if (!db || !userId) return;
    const path = `/artifacts/${appId}/users/${userId}/diet_logs`;
    const logsRef = collection(db, path);
    const logsQuery = query(logsRef, orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        setLogs(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => setError("無法載入飲食記錄。")
    );
    return () => unsubscribe();
  }, [db, userId]);

  const fetchLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("您的瀏覽器不支持地理定位功能。");
      return;
    }
    setIsLocating(true);
    setCurrentLocation(null);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCurrentLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setIsLocating(false);
      },
      (err) => {
        setError(`無法獲取 GPS 位置: ${err.message}`);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  }, []);

  const formatLogForCopy = useCallback((log) => {
    const date =
      log.timestamp && log.timestamp.toDate
        ? log.timestamp.toDate()
        : new Date();
    const dateTimeString = date.toLocaleString("zh-TW", {
      dateStyle: "long",
      timeStyle: "medium",
    });
    const locationString = log.location
      ? `\n📍 地點座標: Lat ${log.location.lat.toFixed(
          6
        )}, Lon ${log.location.lon.toFixed(6)}`
      : "";
    return `--- ${log.meal_name} ---\n📅 時間: ${dateTimeString}${locationString}\n原始描述: ${log.description}\n🔥 熱量: ${log.calories} kcal, 💪 蛋白質: ${log.protein} g, 🥑 脂肪: ${log.fat} g, 🍚 碳水化合物: ${log.carbs} g\n`;
  }, []);

  const performCopy = useCallback(
    (sourceLogs, isSingleLog = false) => {
      let logsToCopy = [];
      let title = "NutriTrack 飲食記錄";

      if (isSingleLog) {
        logsToCopy = Array.isArray(sourceLogs) ? sourceLogs : [sourceLogs];
        title += " (單筆)";
      } else if (selectedLogIds.length > 0) {
        logsToCopy = sourceLogs.filter((log) =>
          selectedLogIds.includes(log.id)
        );
        title += ` 選取記錄 (${logsToCopy.length} 筆)`;
      } else {
        logsToCopy = sourceLogs;
        title += ` (${logsToCopy.length} 筆)`;
      }

      if (logsToCopy.length === 0) {
        setError("沒有可複製的記錄。");
        return;
      }

      const content =
        `${title}\n========================================\n\n` +
        logsToCopy.map(formatLogForCopy).join("\n");

      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand("copy");
        setCopyStatus("success");
        setTimeout(() => setCopyStatus(null), 3000);
      } catch (err) {
        setError("複製失敗");
      } finally {
        document.body.removeChild(textarea);
      }
    },
    [selectedLogIds, formatLogForCopy]
  );

  const analyzeFood = useCallback(async () => {
    if (!foodInput.trim() && !imageData) {
      setError("請輸入食物描述或上傳圖片。");
      return;
    }
    setError(null);
    setLoading(true);
    setAnalysisResult(null);

    const userQuery = `請分析：${foodInput}。估算熱量(Calories), 蛋白質(Protein), 脂肪(Fat), 碳水(Carbs)。`;
    const parts = [];
    if (imageData)
      parts.push({
        inlineData: {
          mimeType: imageFile?.type || "image/jpeg",
          data: imageData.split(",")[1],
        },
      });
    parts.push({ text: userQuery });

    try {
      const response = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                meal_name: { type: "STRING" },
                calories: { type: "NUMBER" },
                protein: { type: "NUMBER" },
                fat: { type: "NUMBER" },
                carbs: { type: "NUMBER" },
              },
              required: ["meal_name", "calories", "protein", "fat", "carbs"],
            },
          },
        }),
      });
      if (!response.ok) throw new Error(`Error ${response.status}`);
      const result = await response.json();
      const data = JSON.parse(
        result.candidates?.[0]?.content?.parts?.[0]?.text
      );
      setAnalysisResult({
        meal_name: data.meal_name || "未命名餐點",
        calories: Math.round(data.calories || 0),
        protein: Math.round(data.protein || 0),
        fat: Math.round(data.fat || 0),
        carbs: Math.round(data.carbs || 0),
        description: foodInput || (imageFile ? "圖片分析" : ""),
      });
    } catch (e) {
      console.error(e);
      setError(`分析錯誤: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [foodInput, imageData, imageFile]);

  const saveLog = useCallback(async () => {
    if (!db || !userId || !analysisResult) return;
    setLoading(true);
    try {
      await addDoc(
        collection(db, `/artifacts/${appId}/users/${userId}/diet_logs`),
        {
          ...analysisResult,
          location: currentLocation || null,
          timestamp: serverTimestamp(),
        }
      );
      setFoodInput("");
      setAnalysisResult(null);
      setImageData(null);
      setImageFile(null);
      setCurrentLocation(null);
      setIsModalOpen(false);
    } catch (e) {
      setError(`儲存失敗: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [db, userId, analysisResult, currentLocation]);

  const today = new Date().toDateString();
  const dailySummary = useMemo(() => {
    return logs
      .filter((log) => {
        const d = log.timestamp?.toDate
          ? log.timestamp.toDate()
          : log.timestamp instanceof Date
          ? log.timestamp
          : null;
        return d && d.toDateString() === today;
      })
      .reduce(
        (acc, log) => ({
          calories: acc.calories + (log.calories || 0),
          protein: acc.protein + (log.protein || 0),
          fat: acc.fat + (log.fat || 0),
          carbs: acc.carbs + (log.carbs || 0),
        }),
        { calories: 0, protein: 0, fat: 0, carbs: 0 }
      );
  }, [logs, today]);

  const historyLogs = useMemo(() => {
    return logs.filter((log) => {
      const d = log.timestamp?.toDate
        ? log.timestamp.toDate()
        : log.timestamp instanceof Date
        ? log.timestamp
        : null;
      return d && getLocalDateString(d) === historyDate;
    });
  }, [logs, historyDate]);

  const historySummary = useMemo(() => {
    return historyLogs.reduce(
      (acc, log) => ({
        calories: acc.calories + (log.calories || 0),
        protein: acc.protein + (log.protein || 0),
        fat: acc.fat + (log.fat || 0),
        carbs: acc.carbs + (log.carbs || 0),
      }),
      { calories: 0, protein: 0, fat: 0, carbs: 0 }
    );
  }, [historyLogs]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result.length > 5 * 1024 * 1024) setError("圖片太大");
        else {
          setImageData(reader.result);
          setError(null);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleLogSelection = (id) => {
    setSelectedLogIds((prev) =>
      prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id]
    );
  };

  // --- Views ---
  const ResultField = ({ label, unit, value, name, onUpdate, isNumeric }) => (
    <div className="flex items-center text-sm mb-1">
      <label className="w-1/3 text-gray-600 font-medium">{label}</label>
      <input
        type={isNumeric ? "number" : "text"}
        className="w-2/3 p-2 border rounded bg-gray-50"
        value={value}
        onChange={(e) => {
          const v = isNumeric
            ? Math.max(0, parseInt(e.target.value) || 0)
            : e.target.value;
          onUpdate((p) => ({ ...p, [name]: v }));
        }}
      />
      {unit && <span className="ml-1 text-xs text-gray-400">{unit}</span>}
    </div>
  );

  const LogsDisplay = ({ logsToShow, emptyMsg, showDateHeader = false }) => {
    const grouped = useMemo(() => {
      if (!showDateHeader) return { list: logsToShow };
      const g = {};
      logsToShow.forEach((log) => {
        const d = log.timestamp?.toDate ? log.timestamp.toDate() : new Date();
        const k = d.toISOString().split("T")[0];
        if (!g[k]) g[k] = [];
        g[k].push(log);
      });
      return g;
    }, [logsToShow, showDateHeader]);

    const keys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    if (logsToShow.length === 0)
      return (
        <p className="text-gray-400 text-center py-8 italic">{emptyMsg}</p>
      );

    return (
      <div className="space-y-6">
        {keys.map((key) => (
          <div key={key}>
            {showDateHeader && (
              <h3 className="text-lg font-bold text-gray-700 sticky top-0 bg-gray-50 p-2 rounded-lg shadow-sm mb-3 z-10">
                {formatDate(grouped[key][0].timestamp.toDate())}{" "}
                <span className="text-sm font-normal text-gray-400 ml-2">
                  ({key})
                </span>
              </h3>
            )}
            <div className="space-y-3">
              {grouped[key].map((log) => {
                const isSel = selectedLogIds.includes(log.id);
                return (
                  <div
                    key={log.id}
                    onClick={() => toggleLogSelection(log.id)}
                    className={`p-4 border rounded-xl bg-white shadow-sm transition cursor-pointer flex items-start ${
                      isSel
                        ? "ring-2 ring-indigo-500 bg-indigo-50"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="pt-1 pr-3">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          isSel
                            ? "bg-indigo-600 border-indigo-600"
                            : "border-gray-300"
                        }`}
                      >
                        {isSel && (
                          <LucideCheckCircle className="w-3 h-3 text-white" />
                        )}
                      </div>
                    </div>
                    <div className="flex-grow min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-bold text-indigo-800 truncate">
                          {log.meal_name}
                        </h4>
                        <div className="text-xs text-gray-400 text-right">
                          {log.timestamp
                            ?.toDate?.()
                            .toLocaleTimeString("zh-TW", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          {log.location && (
                            <div className="flex items-center justify-end mt-0.5">
                              <LucideTarget className="w-3 h-3 mr-0.5" /> GPS
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 mb-2 truncate">
                        {log.description}
                      </p>
                      <div className="bg-gray-100 rounded p-2 overflow-x-auto no-scrollbar">
                        <div className="flex space-x-3 text-xs font-medium whitespace-nowrap">
                          <span className="text-green-700 bg-green-100 px-2 py-0.5 rounded">
                            熱量: {log.calories}
                          </span>
                          <span className="text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                            蛋白: {log.protein}
                          </span>
                          <span className="text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded">
                            脂肪: {log.fat}
                          </span>
                          <span className="text-red-700 bg-red-100 px-2 py-0.5 rounded">
                            碳水: {log.carbs}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Views
  const DashboardView = () => (
    <>
      <div className="p-4 bg-white shadow-xl rounded-2xl mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-extrabold text-gray-800">
            今日營養總結
          </h2>
          <div className="text-xs font-mono text-gray-400 p-1 border rounded">
            UID: {userId?.substring(0, 4)}
          </div>
        </div>
        <div className="flex flex-wrap justify-between -m-1 md:-m-2">
          <NutrientCard
            label="總熱量"
            value={dailySummary.calories}
            unit="kcal"
            color="green"
            icon={<LucideFlame className="w-5 h-5" />}
          />
          <NutrientCard
            label="蛋白質"
            value={dailySummary.protein}
            unit="g"
            color="blue"
            icon={<LucideDrumstick className="w-5 h-5" />}
          />
          <NutrientCard
            label="脂肪"
            value={dailySummary.fat}
            unit="g"
            color="yellow"
            icon={<LucidePizza className="w-5 h-5" />}
          />
          <NutrientCard
            label="碳水"
            value={dailySummary.carbs}
            unit="g"
            color="red"
            icon={<LucideWheat className="w-5 h-5" />}
          />
        </div>
      </div>
      <button
        onClick={() => {
          setCurrentView("history");
          setSelectedLogIds([]);
        }}
        className="w-full p-4 mb-6 bg-white border-2 border-indigo-100 rounded-2xl shadow-sm flex items-center justify-center group hover:border-indigo-300 transition"
      >
        <div className="p-3 rounded-full bg-indigo-50 text-indigo-600 mr-4">
          <LucideHistory className="w-6 h-6" />
        </div>
        <div className="text-left flex-grow">
          <h3 className="text-lg font-bold text-gray-800">查看飲食紀錄</h3>
          <p className="text-sm text-gray-500">查詢歷史日期資料</p>
        </div>
        <LucideArrowLeft className="w-5 h-5 transform rotate-180 text-gray-300" />
      </button>
      <div className="p-4 bg-white shadow-xl rounded-2xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">飲食日誌</h2>
          <button
            onClick={() => performCopy(logs)}
            disabled={logs.length === 0}
            className={`text-sm px-3 py-2 rounded-xl font-medium transition flex items-center ${
              logs.length === 0
                ? "bg-gray-200 text-gray-400"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
            }`}
          >
            <LucideCopy className="w-4 h-4 mr-2" />{" "}
            {selectedLogIds.length > 0
              ? `複製選取的 ${selectedLogIds.length} 筆`
              : "一鍵複製所有紀錄"}
          </button>
        </div>
        <LogsDisplay
          logsToShow={logs}
          emptyMsg="尚無記錄，按 + 新增"
          showDateHeader={true}
        />
      </div>
    </>
  );

  const HistoryView = () => (
    <div className="bg-white shadow-xl rounded-2xl min-h-[80vh] flex flex-col">
      <div className="p-4 border-b bg-gray-50 rounded-t-2xl sticky top-0 z-20">
        <div className="flex items-center mb-4">
          <button
            onClick={() => {
              setCurrentView("dashboard");
              setSelectedLogIds([]);
            }}
            className="mr-3 p-2 rounded-full hover:bg-gray-200"
          >
            <LucideArrowLeft className="w-6 h-6 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-800">飲食紀錄查詢</h2>
        </div>
        <div className="flex items-center bg-white p-1 rounded-xl border shadow-sm">
          <LucideCalendar className="w-5 h-5 text-gray-500 ml-3" />
          <input
            type="date"
            value={historyDate}
            onChange={(e) => setHistoryDate(e.target.value)}
            className="w-full p-3 outline-none font-medium bg-transparent"
          />
        </div>
      </div>
      <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex justify-between text-center">
        {["calories", "protein", "fat", "carbs"].map((k) => (
          <div key={k}>
            <div className="text-lg font-bold text-gray-800">
              {Math.round(historySummary[k])}
            </div>
            <div className="text-xs text-gray-500 capitalize">
              {k === "calories" ? "kcal" : k}
            </div>
          </div>
        ))}
      </div>
      <div className="p-4 flex-grow">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-gray-500">{historyLogs.length} 筆</span>
          <button
            onClick={() => performCopy(historyLogs)}
            disabled={historyLogs.length === 0}
            className={`text-sm px-3 py-2 rounded-lg font-medium transition flex items-center ${
              historyLogs.length === 0
                ? "bg-gray-200 text-gray-400"
                : "bg-indigo-100 text-indigo-700"
            }`}
          >
            <LucideCopy className="w-4 h-4 mr-1" />{" "}
            {selectedLogIds.length > 0 ? `複製選取` : "一鍵複製所有紀錄"}
          </button>
        </div>
        <LogsDisplay
          logsToShow={historyLogs}
          emptyMsg={`${historyDate} 無記錄`}
          showDateHeader={false}
        />
      </div>
    </div>
  );

  if (!isAuthReady)
    return (
      <div className="flex h-screen items-center justify-center">
        <LucideLoader className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-50 font-sans p-4 md:p-8 pb-24">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold text-indigo-700">NutriTrack</h1>
      </header>
      <main className="max-w-4xl mx-auto">
        {currentView === "dashboard" ? <DashboardView /> : <HistoryView />}
      </main>
      <button
        className="fixed bottom-6 right-6 p-4 rounded-full bg-indigo-600 text-white shadow-2xl hover:scale-105 transition z-50"
        onClick={() => setIsModalOpen(true)}
      >
        <LucidePlus className="w-6 h-6" />
      </button>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setIsModalOpen(false)}
          ></div>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between mb-4">
              <h3 className="text-xl font-bold">智能飲食記錄</h3>
              <button onClick={() => setIsModalOpen(false)}>
                <LucideX className="text-gray-400" />
              </button>
            </div>
            {error && (
              <div className="bg-red-100 text-red-700 p-3 rounded mb-4 flex items-center">
                <LucideAlertTriangle className="mr-2 w-5 h-5" />
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex items-center justify-center space-x-4 bg-gray-50">
                <label className="cursor-pointer flex items-center px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50">
                  <LucideCamera className="w-5 h-5 mr-2 text-gray-600" />
                  {imageFile ? "更換圖片" : "拍照/上傳"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChange}
                  />
                </label>
                {imageFile && (
                  <span className="text-xs text-green-600 font-bold">
                    已選取
                  </span>
                )}
              </div>
              <button
                onClick={fetchLocation}
                disabled={isLocating}
                className={`w-full py-2 rounded-lg border flex items-center justify-center ${
                  currentLocation
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-white border-gray-300 text-gray-700"
                }`}
              >
                {isLocating ? (
                  <LucideLoader className="animate-spin w-4 h-4 mr-2" />
                ) : (
                  <LucideTarget className="w-4 h-4 mr-2" />
                )}
                {currentLocation ? "已獲取 GPS" : "獲取 GPS 位置"}
              </button>
              <textarea
                rows="3"
                className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-indigo-500"
                placeholder="描述食物..."
                value={foodInput}
                onChange={(e) => setFoodInput(e.target.value)}
              ></textarea>
              <button
                onClick={analyzeFood}
                disabled={loading}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:bg-gray-300 flex justify-center items-center"
              >
                {loading ? (
                  <LucideLoader className="animate-spin mr-2" />
                ) : (
                  "開始 AI 分析"
                )}
              </button>
            </div>

            {analysisResult && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex justify-between mb-3">
                  <h4 className="font-bold text-green-800">分析結果</h4>
                  <button
                    onClick={() => performCopy(analysisResult, true)}
                    className="text-xs bg-white border border-green-300 text-green-700 px-2 py-1 rounded shadow-sm flex items-center"
                  >
                    <LucideCopy className="w-3 h-3 mr-1" /> 複製
                  </button>
                </div>
                <ResultField
                  label="名稱"
                  value={analysisResult.meal_name}
                  name="meal_name"
                  onUpdate={setAnalysisResult}
                />
                <ResultField
                  label="熱量"
                  unit="kcal"
                  value={analysisResult.calories}
                  name="calories"
                  onUpdate={setAnalysisResult}
                  isNumeric
                />
                <ResultField
                  label="蛋白質"
                  unit="g"
                  value={analysisResult.protein}
                  name="protein"
                  onUpdate={setAnalysisResult}
                  isNumeric
                />
                <ResultField
                  label="脂肪"
                  unit="g"
                  value={analysisResult.fat}
                  name="fat"
                  onUpdate={setAnalysisResult}
                  isNumeric
                />
                <ResultField
                  label="碳水"
                  unit="g"
                  value={analysisResult.carbs}
                  name="carbs"
                  onUpdate={setAnalysisResult}
                  isNumeric
                />
                <button
                  onClick={saveLog}
                  disabled={loading}
                  className="w-full mt-4 py-3 bg-green-600 text-white rounded-xl font-bold shadow hover:bg-green-700"
                >
                  儲存
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {copyStatus === "success" && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-full shadow-lg flex items-center z-50">
          <LucideCheckCircle className="w-4 h-4 mr-2 text-green-400" /> 已複製
        </div>
      )}
    </div>
  );
}
