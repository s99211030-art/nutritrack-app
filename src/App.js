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
// 引入所需的 Lucide 圖標
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

// --- 全局變量 (由 Canvas 環境提供) ---
const appId = "nutritrack-mobile"; // 修正為固定的App ID
const firebaseConfig = {
  apiKey: "AIzaSyCu02zo17EDVCl0zTqz3Sc3fhfkpGJCHk0", // 請替換為您的實際金鑰
  authDomain: "nutritrack-21b55.firebaseapp.com",
  projectId: "nutritrack-21b55",
  storageBucket: "nutritrack-21b55.appspot.com", // 修正 storageBucket 域名
  messagingSenderId: "605701087586",
  appId: "1:605701087586:web:847dd05f4f61da2948cc3b",
  measurementId: "G-6TLMZG21JT",
};
const initialAuthToken =
  typeof __initial_auth_token !== "undefined" ? __initial_auth_token : null;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=`;

// --- 介面組件：營養卡片 ---

/**
 * 繪製單一營養素的總計卡片 (基礎樣式 - 選項 A: 獨立卡片)
 */
const NutrientCard = ({ label, value, unit, color, icon }) => {
  // 確保所有類別都已定義並應用，特別是 flex 和 width 類別
  const textColor = `text-${color}-700`;
  const iconColor = `text-${color}-600`;

  return (
    // 修正排版：使用 flex-none 來防止被擠壓，使用 w-full 來確保響應式
    <div
      className={`flex flex-col justify-between items-start p-4 w-full sm:w-[calc(50%-8px)] md:w-[calc(25%-8px)] rounded-xl bg-white shadow-lg border border-gray-100 transform hover:shadow-xl transition duration-300 m-1 md:m-2 flex-none`}
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

// --- 工具函式：指數退避 (Exponential Backoff) 處理 API 請求 ---
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

// --- 輔助函式：日期格式化 ---
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

// 輔助函式：取得 YYYY-MM-DD 字串 (本地時間)
const getLocalDateString = (date) => {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().split("T")[0];
};

// --- Main App Component ---
export default function App() {
  // Firebase 狀態
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // App 狀態
  const [currentView, setCurrentView] = useState("dashboard"); // 'dashboard' | 'history'
  const [logs, setLogs] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [foodInput, setFoodInput] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null);

  // 歷史紀錄狀態
  const [historyDate, setHistoryDate] = useState(
    getLocalDateString(new Date())
  );

  // 圖片與定位狀態
  const [imageFile, setImageFile] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);

  // 選取日誌狀態
  const [selectedLogIds, setSelectedLogIds] = useState([]);

  // 1. Firebase 初始化和身份驗證
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
              // 這裡我們不使用 initialAuthToken，因為我們是在部署環境
              await signInAnonymously(firebaseAuth);
            } catch (e) {
              console.error(
                "Token sign in failed, falling back to anonymous:",
                e
              );
              await signInAnonymously(firebaseAuth);
            }
          } else {
            await signInAnonymously(firebaseAuth);
          }
        }

        const currentUser = firebaseAuth.currentUser;
        if (currentUser) {
          setUserId(currentUser.uid);
        } else {
          // 確保即使連線失敗也有 UUID
          setUserId(crypto.randomUUID());
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Firebase initialization failed:", e);
      setError("應用程式初始化失敗。請檢查 Firebase 配置。");
      setIsAuthReady(true);
    }
  }, []);

  // 2. 獲取飲食記錄 (即時監聽)
  useEffect(() => {
    if (!db || !userId) return;

    // 確保路徑使用 appId
    const path = `/artifacts/${appId}/users/${userId}/diet_logs`;
    const logsRef = collection(db, path);
    const logsQuery = query(logsRef, orderBy("timestamp", "desc"));

    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const newLogs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setLogs(newLogs);
      },
      (err) => {
        console.error("Error fetching logs:", err);
        setError("無法載入飲食記錄。");
      }
    );

    return () => unsubscribe();
  }, [db, userId]);

  // 3. 獲取 GPS
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
        console.warn("Geolocation error:", err);
        setError(`無法獲取 GPS 位置: ${err.message}`);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  }, []);

  // 格式化複製內容
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
      : ""; // 移除 (未記錄)

    return (
      `--- ${log.meal_name} ---\n` +
      `📅 時間: ${dateTimeString}${locationString}\n` +
      `原始描述: ${log.description}\n` +
      `🔥 熱量: ${log.calories} kcal, 💪 蛋白質: ${log.protein} g, 🥑 脂肪: ${log.fat} g, 🍚 碳水化合物: ${log.carbs} g\n`
    );
  }, []);

  // 統一複製功能 (支援上下文)
  const performCopy = useCallback(
    (sourceLogs, isSingleLog = false) => {
      let logsToCopy = [];
      let title = "NutriTrack 飲食記錄";

      if (isSingleLog) {
        // 處理單一分析結果的複製
        logsToCopy = Array.isArray(sourceLogs) ? sourceLogs : [sourceLogs];
        title += " (單筆)";
      } else if (selectedLogIds.length > 0) {
        // 如果有選取，從 sourceLogs 中篩選出被選取的
        logsToCopy = sourceLogs.filter((log) =>
          selectedLogIds.includes(log.id)
        );
        title += ` 選取記錄 (${logsToCopy.length} 筆)`;
      } else {
        // 如果沒選取，複製 sourceLogs 全體
        logsToCopy = sourceLogs;
        title += ` (${logsToCopy.length} 筆)`;
      }

      if (logsToCopy.length === 0) {
        setError("沒有可複製的記錄。");
        return;
      }

      const header = `${title}\n========================================\n\n`;
      const body = logsToCopy.map(formatLogForCopy).join("\n");
      const formattedText = header + body;

      const textarea = document.createElement("textarea");
      textarea.value = formattedText;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        document.execCommand("copy");
        setCopyStatus("success");
        setTimeout(() => setCopyStatus(null), 3000);
        setSelectedLogIds([]); // 複製完成後清除選取
      } catch (err) {
        setError("複製失敗");
      } finally {
        document.body.removeChild(textarea);
      }
    },
    [selectedLogIds, formatLogForCopy]
  );

  // 6. AI 分析
  const analyzeFood = useCallback(async () => {
    if (!foodInput.trim() && !imageData) {
      setError("請輸入食物描述或上傳圖片進行分析。");
      return;
    }

    setError(null);
    setLoading(true);
    setAnalysisResult(null);

    const systemPrompt = `您是一個專業的營養分析師。根據用戶提供的圖片和/或飲食描述，請提供客觀且合理的營養素估算。
            輸出必須是一個 JSON 物件。如果無法判斷，請盡力提供最接近的估算。
            營養素估算值必須是數字，不包含單位。`;

    const userQuery = `請分析這餐的食物 (參考圖片，如果有的話)：${
      foodInput || "（無額外文字描述）"
    }。請為這餐命名，並估算其熱量（Calories）、蛋白質（Protein）、脂肪（Fat）、碳水化合物（Carbs）。`;

    const responseSchema = {
      type: "OBJECT",
      properties: {
        meal_name: {
          type: "STRING",
          description: "這餐的簡短名稱，例如: 牛肉麵午餐",
        },
        calories: { type: "NUMBER", description: "總卡路里 (kcal)" },
        protein: { type: "NUMBER", description: "蛋白質 (g)" },
        fat: { type: "NUMBER", description: "脂肪 (g)" },
        carbs: { type: "NUMBER", description: "碳水化合物 (g)" },
      },
      required: ["meal_name", "calories", "protein", "fat", "carbs"],
    };

    const parts = [];
    if (imageData) {
      const mimeType = imageFile?.type || "image/jpeg";
      const base64Data = imageData.split(",")[1];
      parts.push({ inlineData: { mimeType, data: base64Data } });
    }
    parts.push({ text: userQuery });

    const payload = {
      contents: [{ parts: parts }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    };

    try {
      const response = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok)
        throw new Error(`API 請求失敗，狀態碼: ${response.status}`);

      const result = await response.json();
      const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (jsonText) {
        const parsedData = JSON.parse(jsonText);
        setAnalysisResult({
          meal_name: parsedData.meal_name || foodInput.substring(0, 15) + "...",
          calories: Math.round(parsedData.calories || 0),
          protein: Math.round(parsedData.protein || 0),
          fat: Math.round(parsedData.fat || 0),
          carbs: Math.round(parsedData.carbs || 0),
          description: foodInput || (imageFile ? "圖片分析記錄" : ""),
        });
      } else {
        setError("AI 分析失敗。請嘗試更具體的描述或更清晰的圖片。");
      }
    } catch (e) {
      console.error("Gemini API error:", e);
      setError(`營養分析發生錯誤: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [foodInput, imageData, imageFile]);

  // 7. 儲存 (Save Log)
  const saveLog = useCallback(async () => {
    if (!db || !userId || !analysisResult) {
      setError("無法儲存：資料庫或分析結果缺失。");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const path = `/artifacts/${appId}/users/${userId}/diet_logs`;
      await addDoc(collection(db, path), {
        ...analysisResult,
        location: currentLocation || null,
        timestamp: serverTimestamp(),
      });

      // 清空狀態
      setFoodInput("");
      setAnalysisResult(null);
      setImageData(null);
      setImageFile(null);
      setCurrentLocation(null);
      setTimeout(() => setIsModalOpen(false), 200);
    } catch (e) {
      console.error("Firestore save error:", e);
      setError(`儲存記錄失敗: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [db, userId, analysisResult, currentLocation]);

  // 8. 數據處理
  const today = new Date().toDateString();

  // 當日總計
  const dailySummary = useMemo(() => {
    const todayLogs = logs.filter((log) => {
      if (!log.timestamp) return false;
      let logDate;
      if (log.timestamp.toDate) logDate = log.timestamp.toDate();
      else if (log.timestamp instanceof Date) logDate = log.timestamp;
      else return false;
      return logDate.toDateString() === today;
    });

    return todayLogs.reduce(
      (acc, log) => ({
        calories: acc.calories + (log.calories || 0),
        protein: acc.protein + (log.protein || 0),
        fat: acc.fat + (log.fat || 0),
        carbs: acc.carbs + (log.carbs || 0),
      }),
      { calories: 0, protein: 0, fat: 0, carbs: 0 }
    );
  }, [logs, today]);

  // 歷史紀錄篩選
  const historyLogs = useMemo(() => {
    return logs.filter((log) => {
      if (!log.timestamp) return false;
      let logDate;
      if (log.timestamp.toDate) logDate = log.timestamp.toDate();
      else if (log.timestamp instanceof Date) logDate = log.timestamp;
      else return false;

      // 比對 YYYY-MM-DD
      const logDateStr = getLocalDateString(logDate);
      return logDateStr === historyDate;
    });
  }, [logs, historyDate]);

  // 歷史紀錄當日總計
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

  const handleImageChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result.length > 5 * 1024 * 1024) {
          setError("圖片檔案過大，請選擇較小的圖片。");
          setImageData(null);
          setImageFile(null);
          return;
        }
        setImageData(reader.result);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleLogSelection = (id) => {
    setSelectedLogIds((prev) =>
      prev.includes(id) ? prev.filter((logId) => logId !== id) : [...prev, id]
    );
  };

  // Loading Screen
  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <LucideLoader className="w-8 h-8 mr-2 animate-spin text-indigo-500" />
        <p className="text-gray-600">正在載入應用程式...</p>
      </div>
    );
  }

  // Components
  const ResultField = ({
    label,
    unit,
    value,
    name,
    onUpdate,
    isNumeric = false,
  }) => (
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

  // 共用的日誌列表顯示組件
  const LogsDisplay = ({ logsToShow, emptyMsg, showDateHeader = false }) => {
    // Grouping for main dashboard
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

  // --- 儀表板視圖 (DashboardView) ---
  const DashboardView = () => (
    <>
      <div className="p-4 md:p-6 bg-white shadow-xl rounded-2xl mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-extrabold text-gray-800">
            今日營養總結
          </h2>
          <div className="text-xs font-mono text-gray-400 p-1 border rounded">
            UID: {userId ? userId.substring(0, 4) : "..."}
          </div>
        </div>
        {/* 修正排版：確保父容器使用 flex 且允許換行 */}
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

      {/* 新增：飲食紀錄按鈕 */}
      <button
        onClick={() => {
          setCurrentView("history");
          setSelectedLogIds([]);
        }}
        className="w-full p-4 mb-6 bg-white border-2 border-indigo-100 hover:border-indigo-300 rounded-2xl shadow-md hover:shadow-lg transition flex items-center justify-center group"
      >
        <div className="p-3 rounded-full bg-indigo-50 text-indigo-600 mr-4 group-hover:bg-indigo-100 transition">
          <LucideHistory className="w-6 h-6" />
        </div>
        <div className="text-left flex-grow">
          <h3 className="text-lg font-bold text-gray-800">查看飲食紀錄</h3>
          <p className="text-sm text-gray-500">查詢歷史日期資料</p>
        </div>
        <div className="ml-auto text-gray-300">
          <LucideArrowLeft className="w-5 h-5 transform rotate-180" />
        </div>
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

  // --- 歷史紀錄視圖 (HistoryView) ---
  const HistoryView = () => (
    <div className="bg-white shadow-xl rounded-2xl min-h-[80vh] flex flex-col">
      {/* Header with Back Button & Date Picker */}
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
            onChange={(e) => {
              setHistoryDate(e.target.value);
              setSelectedLogIds([]);
            }} // 切換日期時清除選取
            className="w-full p-3 outline-none font-medium bg-transparent"
          />
        </div>
      </div>

      {/* Date Summary */}
      <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex justify-between text-center">
        {["calories", "protein", "fat", "carbs"].map((k) => (
          <div key={k} className="flex-1">
            <div className="text-lg font-bold text-gray-800">
              {Math.round(historySummary[k])}
            </div>
            <div className="text-xs text-gray-500 capitalize">
              {k === "calories"
                ? "kcal"
                : k === "protein"
                ? "蛋白"
                : k === "fat"
                ? "脂肪"
                : "碳水"}
            </div>
          </div>
        ))}
      </div>

      {/* List */}
      <div className="p-4 flex-grow overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-gray-500">
            {historyLogs.length} 筆記錄
          </span>
          <button
            onClick={() => performCopy(historyLogs)}
            disabled={historyLogs.length === 0}
            className={`text-sm px-3 py-2 rounded-lg font-medium transition flex items-center ${
              historyLogs.length === 0
                ? "bg-gray-200 text-gray-400"
                : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
            }`}
          >
            <LucideCopy className="w-4 h-4 mr-1" />{" "}
            {selectedLogIds.length > 0
              ? `複製選取的 ${selectedLogIds.length} 筆`
              : "一鍵複製所有紀錄"}
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

  // --- RecordModal 組件定義 ---
  const RecordModal = (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto ${
        isModalOpen ? "block" : "hidden"
      }`}
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          aria-hidden="true"
          onClick={() => setIsModalOpen(false)}
        ></div>

        <span
          className="hidden sm:inline-block sm:align-middle sm:h-screen"
          aria-hidden="true"
        >
          &#8203;
        </span>

        <div className="inline-block align-bottom bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-white p-6">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h3
                className="text-xl leading-6 font-bold text-gray-900"
                id="modal-title"
              >
                智能飲食記錄
              </h3>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 transition"
                onClick={() => {
                  setIsModalOpen(false);
                  setAnalysisResult(null);
                  setFoodInput("");
                  setImageData(null);
                  setImageFile(null);
                  setCurrentLocation(null);
                  setError(null);
                }}
              >
                <LucideX className="w-6 h-6" />
              </button>
            </div>

            {/* 錯誤提示 */}
            {error && (
              <div
                className="flex items-center p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-lg"
                role="alert"
              >
                <LucideAlertTriangle className="w-5 h-5 mr-2" />
                <div>{error}</div>
              </div>
            )}

            {/* 1. 圖片上傳/拍照區 */}
            <div className="mb-4 p-3 border border-dashed border-gray-300 rounded-xl">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                圖片記錄 (可選):
              </label>
              <div className="flex items-center space-x-4">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageChange}
                  className="hidden"
                  id="image-upload"
                  disabled={loading || analysisResult}
                />
                <label
                  htmlFor="image-upload"
                  className="cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 rounded-xl shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition"
                >
                  <LucideCamera className="w-5 h-5 mr-2" />
                  {imageFile
                    ? imageFile.name.substring(0, 20) + "..."
                    : "選擇圖片 / 拍照"}
                </label>
                {imageFile && (
                  <button
                    onClick={() => {
                      setImageFile(null);
                      setImageData(null);
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                    aria-label="移除圖片"
                  >
                    <LucideX className="w-5 h-5" />
                  </button>
                )}
              </div>
              {imageData && (
                <img
                  src={imageData}
                  alt="Meal Preview"
                  className="mt-3 w-32 h-32 object-cover rounded-xl border-2 border-indigo-200"
                />
              )}
            </div>

            {/* 2. GPS 定位區 */}
            <div className="mb-4 p-3 border border-dashed border-gray-300 rounded-xl">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                GPS 定位 (可選):
              </label>
              <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
                <button
                  onClick={fetchLocation}
                  className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-xl shadow-sm transition ${
                    isLocating
                      ? "bg-yellow-400 text-yellow-900 cursor-not-allowed"
                      : currentLocation
                      ? "bg-green-600 text-white hover:bg-green-700"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                  disabled={isLocating || analysisResult}
                >
                  {isLocating ? (
                    <>
                      <LucideLoader className="w-4 h-4 mr-2 animate-spin" />
                      定位中...
                    </>
                  ) : currentLocation ? (
                    <>
                      <LucideCheckCircle className="w-4 h-4 mr-2" />
                      已定位
                    </>
                  ) : (
                    <>
                      <LucideTarget className="w-4 h-4 mr-2" />
                      獲取 GPS 位置
                    </>
                  )}
                </button>
                {currentLocation && (
                  <div className="text-sm text-gray-500 flex items-center p-2 rounded-lg bg-gray-100">
                    Lat: {currentLocation.lat.toFixed(4)}, Lon:{" "}
                    {currentLocation.lon.toFixed(4)}
                  </div>
                )}
              </div>
            </div>

            {/* 3. 輸入區 */}
            <div className="mb-4">
              <label
                htmlFor="food-input"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                用自然語言描述您吃了什麼 (可選，但建議)：
              </label>
              <textarea
                id="food-input"
                rows="3"
                className="w-full border border-gray-300 rounded-lg p-3 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                placeholder="例如：一個牛肉麵、一盤燙青菜，還有一杯無糖綠茶。"
                value={foodInput}
                onChange={(e) => setFoodInput(e.target.value)}
                disabled={loading || analysisResult}
              />
            </div>

            {/* 4. 操作按鈕 */}
            <div className="flex justify-end space-x-3 mb-6">
              <button
                type="button"
                className={`inline-flex justify-center rounded-xl border border-transparent px-4 py-2 text-sm font-medium shadow-sm transition ${
                  loading || analysisResult
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                }`}
                onClick={analyzeFood}
                disabled={
                  loading || analysisResult || (!foodInput.trim() && !imageData)
                }
              >
                {loading ? (
                  <>
                    <LucideLoader className="w-5 h-5 mr-2 animate-spin" />
                    AI 分析中...
                  </>
                ) : (
                  "開始 AI 分析"
                )}
              </button>
            </div>

            {/* 5. 分析結果展示區 */}
            {analysisResult && (
              <div className="p-4 border-2 border-green-200 bg-green-50 rounded-xl">
                <h4 className="text-lg font-bold text-green-800 mb-3 flex justify-between items-center">
                  分析結果 (可微調)
                  {/* 手動複製按鈕 */}
                  <button
                    onClick={() => performCopy([analysisResult], true)} // 使用單筆複製
                    className="flex items-center text-sm px-3 py-1 rounded-full bg-gray-500 text-white hover:bg-gray-600 transition shadow-md"
                    aria-label="手動複製到剪貼板"
                  >
                    <LucideCopy className="w-4 h-4 mr-1" />
                    複製到剪貼板
                  </button>
                </h4>

                {/* 顯示與編輯欄位 */}
                <div className="space-y-2">
                  <ResultField
                    label="餐點名稱"
                    value={analysisResult.meal_name}
                    name="meal_name"
                    onUpdate={setAnalysisResult}
                  />
                  <ResultField
                    label="熱量 (kcal)"
                    unit="kcal"
                    value={analysisResult.calories}
                    name="calories"
                    onUpdate={setAnalysisResult}
                    isNumeric
                  />
                  <ResultField
                    label="蛋白質 (g)"
                    unit="g"
                    value={analysisResult.protein}
                    name="protein"
                    onUpdate={setAnalysisResult}
                    isNumeric
                  />
                  <ResultField
                    label="脂肪 (g)"
                    unit="g"
                    value={analysisResult.fat}
                    name="fat"
                    onUpdate={setAnalysisResult}
                    isNumeric
                  />
                  <ResultField
                    label="碳水化合物 (g)"
                    unit="g"
                    value={analysisResult.carbs}
                    name="carbs"
                    onUpdate={setAnalysisResult}
                    isNumeric
                  />
                </div>
                <div className="mt-4 p-2 text-sm text-gray-600 bg-gray-100 rounded">
                  **原始描述**: {analysisResult.description}
                </div>

                {/* 儲存按鈕 */}
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    className="inline-flex justify-center rounded-xl border border-transparent px-6 py-3 text-base font-medium text-white shadow-lg bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition"
                    onClick={saveLog}
                    disabled={loading}
                  >
                    儲存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // --- 主要佈局 ---
  return (
    <div className="min-h-screen bg-gray-50 font-sans p-4 md:p-8 pb-24">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold text-indigo-700 tracking-tight">
          NutriTrack
        </h1>
        <p className="text-gray-500 text-sm">AI 智能飲食管家</p>
      </header>

      <main className="max-w-4xl mx-auto">
        {/* View Switcher */}
        {currentView === "dashboard" ? <DashboardView /> : <HistoryView />}
      </main>

      {/* 浮動新增按鈕 (僅在 Dashboard 顯示，或兩者皆顯示) */}
      <button
        className="fixed bottom-6 right-6 p-4 rounded-full bg-indigo-600 text-white shadow-2xl hover:bg-indigo-700 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 z-50"
        onClick={() => setIsModalOpen(true)}
        aria-label="新增飲食記錄"
      >
        <LucidePlus className="w-6 h-6" />
      </button>

      {/* 複製成功提示 Toast */}
      {copyStatus === "success" && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-800 bg-opacity-80 text-white px-4 py-2 rounded-full text-sm shadow-lg z-50 flex items-center animate-fade-in-up">
          <LucideCheckCircle className="w-4 h-4 mr-2 text-green-400" />
          已複製到剪貼板
        </div>
      )}

      {isModalOpen && RecordModal}
    </div>
  );
}
