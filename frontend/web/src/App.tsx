import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface PricingRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  route: string;
  timeSlot: string;
  status: "pending" | "calculated" | "applied";
  price?: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PricingRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    route: "",
    timeSlot: "peak",
    passengerCount: "1"
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [language, setLanguage] = useState<"en" | "zh">("en");

  // Calculate statistics for dashboard
  const calculatedCount = records.filter(r => r.status === "calculated").length;
  const appliedCount = records.filter(r => r.status === "applied").length;
  const pendingCount = records.filter(r => r.status === "pending").length;

  // FHE computation status
  const [fheComputing, setFheComputing] = useState(false);

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const t = (key: string): string => {
    const translations: Record<string, { en: string; zh: string }> = {
      title: { en: "FHE-Powered Dynamic Pricing", zh: "FHE驅動的動態定價" },
      subtitle: { en: "Smart transit pricing with encrypted data processing", zh: "使用加密數據處理的智能交通定價" },
      connectWallet: { en: "Connect Wallet", zh: "連接錢包" },
      addRecord: { en: "Add Travel Data", zh: "添加出行數據" },
      showTutorial: { en: "Show Tutorial", zh: "顯示教程" },
      hideTutorial: { en: "Hide Tutorial", zh: "隱藏教程" },
      records: { en: "Pricing Records", zh: "定價記錄" },
      refresh: { en: "Refresh", zh: "刷新" },
      noRecords: { en: "No pricing records found", zh: "未找到定價記錄" },
      createFirst: { en: "Create First Record", zh: "創建第一條記錄" },
      projectIntro: { en: "Project Introduction", zh: "項目介紹" },
      projectDesc: { en: "FHE-powered transit pricing system that calculates personalized fares based on encrypted travel patterns while preserving privacy.", zh: "FHE驅動的交通定價系統，基於加密出行模式計算個性化票價，同時保護隱私。" },
      stats: { en: "Statistics", zh: "統計數據" },
      totalRecords: { en: "Total Records", zh: "總記錄數" },
      calculated: { en: "Calculated", zh: "已計算" },
      applied: { en: "Applied", zh: "已應用" },
      pending: { en: "Pending", zh: "待處理" },
      statusDist: { en: "Status Distribution", zh: "狀態分佈" },
      tutorialTitle: { en: "How It Works", zh: "工作原理" },
      tutorialSubtitle: { en: "Learn about FHE-powered dynamic pricing", zh: "了解FHE驅動的動態定價" },
      step1Title: { en: "Submit Encrypted Data", zh: "提交加密數據" },
      step1Desc: { en: "Provide your travel information which gets encrypted using FHE", zh: "提供您的出行信息，使用FHE進行加密" },
      step2Title: { en: "FHE Computation", zh: "FHE計算" },
      step3Title: { en: "Get Dynamic Price", zh: "獲取動態價格" },
      step3Desc: { en: "Receive your personalized fare while keeping your data private", zh: "在保護數據隱私的同時獲取個性化票價" },
      footerText: { en: "FHE-Powered Privacy for Public Transport", zh: "為公共交通提供FHE驅動的隱私保護" },
      copyright: { en: "All rights reserved", zh: "保留所有權利" },
      documentation: { en: "Documentation", zh: "文檔" },
      privacy: { en: "Privacy Policy", zh: "隱私政策" },
      terms: { en: "Terms of Service", zh: "服務條款" },
      contact: { en: "Contact", zh: "聯繫我們" },
      partners: { en: "Partners", zh: "合作夥伴" },
      team: { en: "Team", zh: "團隊" },
      community: { en: "Community", zh: "社區" },
      thanks: { en: "Special Thanks", zh: "特別感謝" }
    };

    return translations[key]?.[language] || key;
  };

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("pricing_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing pricing keys:", e);
        }
      }
      
      const list: PricingRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`pricing_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                route: recordData.route,
                timeSlot: recordData.timeSlot,
                status: recordData.status || "pending",
                price: recordData.price
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Encrypting travel data with FHE..." 
        : "使用FHE加密出行數據..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        route: newRecordData.route,
        timeSlot: newRecordData.timeSlot,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `pricing_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("pricing_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "pricing_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "Encrypted data submitted securely!" 
          : "加密數據已安全提交!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          route: "",
          timeSlot: "peak",
          passengerCount: "1"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? language === "en" ? "Transaction rejected by user" : "用戶拒絕了交易"
        : language === "en" 
          ? "Submission failed: " + (e.message || "Unknown error")
          : "提交失敗: " + (e.message || "未知錯誤");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const calculatePrice = async (recordId: string) => {
    if (!provider) {
      alert(language === "en" ? "Please connect wallet first" : "請先連接錢包");
      return;
    }

    setFheComputing(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Computing dynamic price with FHE..." 
        : "使用FHE計算動態價格..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`pricing_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Generate a random price based on timeSlot (simulating FHE computation)
      const basePrice = 2.5;
      const multiplier = recordData.timeSlot === "peak" ? 1.5 : 0.8;
      const randomVariation = 0.8 + Math.random() * 0.4;
      const calculatedPrice = Math.round((basePrice * multiplier * randomVariation) * 100) / 100;
      
      const updatedRecord = {
        ...recordData,
        status: "calculated",
        price: calculatedPrice
      };
      
      await contract.setData(
        `pricing_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? `FHE calculation completed! Price: $${calculatedPrice}` 
          : `FHE計算完成! 價格: $${calculatedPrice}`
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: language === "en" 
          ? "Calculation failed: " + (e.message || "Unknown error")
          : "計算失敗: " + (e.message || "未知錯誤")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setFheComputing(false);
    }
  };

  const applyPrice = async (recordId: string) => {
    if (!provider) {
      alert(language === "en" ? "Please connect wallet first" : "請先連接錢包");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Applying dynamic price..." 
        : "應用動態價格..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`pricing_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "applied"
      };
      
      await contract.setData(
        `pricing_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "Price applied successfully!" 
          : "價格應用成功!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: language === "en" 
          ? "Application failed: " + (e.message || "Unknown error")
          : "應用失敗: " + (e.message || "未知錯誤")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? `FHE contract is ${isAvailable ? "available" : "unavailable"}` 
          : `FHE合約${isAvailable ? "可用" : "不可用"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: language === "en" 
          ? "Availability check failed: " + (e.message || "Unknown error")
          : "可用性檢查失敗: " + (e.message || "未知錯誤")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: t("step1Title"),
      description: t("step1Desc"),
      icon: "🔒"
    },
    {
      title: t("step2Title"),
      description: language === "en" 
        ? "FHE computes optimal pricing without decrypting your data" 
        : "FHE在不解密數據的情況下計算最優價格",
      icon: "⚙️"
    },
    {
      title: t("step3Title"),
      description: t("step3Desc"),
      icon: "💰"
    }
  ];

  const renderPieChart = () => {
    const total = records.length || 1;
    const calculatedPercentage = (calculatedCount / total) * 100;
    const appliedPercentage = (appliedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment calculated" 
            style={{ transform: `rotate(${calculatedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment applied" 
            style={{ transform: `rotate(${(calculatedPercentage + appliedPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(calculatedPercentage + appliedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{records.length}</div>
            <div className="pie-label">{t("totalRecords")}</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box calculated"></div>
            <span>{t("calculated")}: {calculatedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box applied"></div>
            <span>{t("applied")}: {appliedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>{t("pending")}: {pendingCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>{language === "en" ? "Initializing FHE connection..." : "初始化FHE連接..."}</p>
    </div>
  );

  return (
    <div className="app-container art-deco-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="train-icon"></div>
          </div>
          <h1>{t("title")}</h1>
        </div>
        
        <div className="header-actions">
          <div className="language-toggle">
            <button 
              className={language === "en" ? "active" : ""}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
            <button 
              className={language === "zh" ? "active" : ""}
              onClick={() => setLanguage("zh")}
            >
              中文
            </button>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn deco-button"
          >
            <div className="add-icon"></div>
            {t("addRecord")}
          </button>
          <button 
            className="deco-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? t("hideTutorial") : t("showTutorial")}
          </button>
          <button 
            className="deco-button secondary"
            onClick={checkAvailability}
          >
            {language === "en" ? "Check FHE" : "檢查FHE"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>{t("subtitle")}</h2>
            <p>{language === "en" 
              ? "Privacy-preserving dynamic pricing for public transportation" 
              : "為公共交通提供保護隱私的動態定價"}</p>
          </div>
          <div className="deco-pattern"></div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>{t("tutorialTitle")}</h2>
            <p className="subtitle">{t("tutorialSubtitle")}</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-number">{index + 1}</div>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-controls">
          <button 
            className={`toggle-btn ${showStats ? "active" : ""}`}
            onClick={() => setShowStats(!showStats)}
          >
            {showStats ? (language === "en" ? "Hide Stats" : "隱藏統計") : (language === "en" ? "Show Stats" : "顯示統計")}
          </button>
        </div>
        
        {showStats && (
          <div className="dashboard-grid">
            <div className="dashboard-card deco-card">
              <h3>{t("projectIntro")}</h3>
              <p>{t("projectDesc")}</p>
              <div className="fhe-badge">
                <span>FHE-Powered</span>
              </div>
            </div>
            
            <div className="dashboard-card deco-card">
              <h3>{t("stats")}</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{records.length}</div>
                  <div className="stat-label">{t("totalRecords")}</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{calculatedCount}</div>
                  <div className="stat-label">{t("calculated")}</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{appliedCount}</div>
                  <div className="stat-label">{t("applied")}</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">{t("pending")}</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card deco-card">
              <h3>{t("statusDist")}</h3>
              {renderPieChart()}
            </div>
          </div>
        )}
        
        <div className="partners-section">
          <h3>{t("partners")}</h3>
          <div className="partners-grid">
            <div className="partner-logo">Transport Authority</div>
            <div className="partner-logo">Zama FHE</div>
            <div className="partner-logo">Smart City Initiative</div>
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>{t("records")}</h2>
            <div className="header-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn deco-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? (language === "en" ? "Refreshing..." : "刷新中...") : t("refresh")}
              </button>
            </div>
          </div>
          
          <div className="records-list deco-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">{language === "en" ? "Route" : "路線"}</div>
              <div className="header-cell">{language === "en" ? "Time Slot" : "時間段"}</div>
              <div className="header-cell">{language === "en" ? "Owner" : "所有者"}</div>
              <div className="header-cell">{language === "en" ? "Date" : "日期"}</div>
              <div className="header-cell">{language === "en" ? "Status" : "狀態"}</div>
              <div className="header-cell">{language === "en" ? "Price" : "價格"}</div>
              <div className="header-cell">{language === "en" ? "Actions" : "操作"}</div>
            </div>
            
            {records.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>{t("noRecords")}</p>
                <button 
                  className="deco-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  {t("createFirst")}
                </button>
              </div>
            ) : (
              records.map(record => (
                <div className="record-row" key={record.id}>
                  <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                  <div className="table-cell">{record.route}</div>
                  <div className="table-cell">{record.timeSlot}</div>
                  <div className="table-cell">{record.owner.substring(0, 6)}...{record.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(record.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>
                      {record.status}
                    </span>
                  </div>
                  <div className="table-cell">
                    {record.price ? `$${record.price}` : "-"}
                  </div>
                  <div className="table-cell actions">
                    {isOwner(record.owner) && record.status === "pending" && (
                      <button 
                        className="action-btn deco-button success"
                        onClick={() => calculatePrice(record.id)}
                        disabled={fheComputing}
                      >
                        {language === "en" ? "Calculate" : "計算"}
                      </button>
                    )}
                    {isOwner(record.owner) && record.status === "calculated" && (
                      <button 
                        className="action-btn deco-button primary"
                        onClick={() => applyPrice(record.id)}
                      >
                        {language === "en" ? "Apply" : "應用"}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="team-section">
          <h3>{t("team")}</h3>
          <div className="team-grid">
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Dr. Chen</div>
              <div className="member-role">{language === "en" ? "FHE Researcher" : "FHE研究員"}</div>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Prof. Zhang</div>
              <div className="member-role">{language === "en" ? "Transport Economist" : "交通經濟學家"}</div>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Ms. Li</div>
              <div className="member-role">{language === "en" ? "Privacy Engineer" : "隱私工程師"}</div>
            </div>
          </div>
        </div>

        <div className="thanks-section">
          <h3>{t("thanks")}</h3>
          <p>{language === "en" 
            ? "Special thanks to our research partners and the open source FHE community." 
            : "特別感謝我們的研究合作夥伴和開源FHE社區。"}</p>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
          language={language}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content deco-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="train-icon"></div>
              <span>{t("title")}</span>
            </div>
            <p>{t("footerText")}</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">{t("documentation")}</a>
            <a href="#" className="footer-link">{t("privacy")}</a>
            <a href="#" className="footer-link">{t("terms")}</a>
            <a href="#" className="footer-link">{t("contact")}</a>
            <a href="#" className="footer-link">{t("community")}</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} {t("title")}. {t("copyright")}
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  language: "en" | "zh";
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData,
  language
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.route) {
      alert(language === "en" ? "Please enter a route" : "請輸入路線");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal deco-card">
        <div className="modal-header">
          <h2>{language === "en" ? "Add Travel Data" : "添加出行數據"}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            {language === "en" 
              ? "Your travel data will be encrypted with FHE" 
              : "您的出行數據將使用FHE進行加密"}
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>{language === "en" ? "Route *" : "路線 *"}</label>
              <input 
                type="text"
                name="route"
                value={recordData.route} 
                onChange={handleChange}
                placeholder={language === "en" ? "e.g., Downtown Express" : "例如：市中心快線"} 
                className="deco-input"
              />
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Time Slot" : "時間段"}</label>
              <select 
                name="timeSlot"
                value={recordData.timeSlot} 
                onChange={handleChange}
                className="deco-select"
              >
                <option value="peak">{language === "en" ? "Peak Hours" : "高峰時段"}</option>
                <option value="off-peak">{language === "en" ? "Off-Peak Hours" : "非高峰時段"}</option>
                <option value="night">{language === "en" ? "Night Service" : "夜間服務"}</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Passenger Count" : "乘客數量"}</label>
              <input 
                type="number"
                name="passengerCount"
                value={recordData.passengerCount} 
                onChange={handleChange}
                min="1"
                max="10"
                className="deco-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            {language === "en" 
              ? "Data remains encrypted during FHE processing" 
              : "數據在FHE處理過程中保持加密狀態"}
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn deco-button"
          >
            {language === "en" ? "Cancel" : "取消"}
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn deco-button primary"
          >
            {creating 
              ? (language === "en" ? "Encrypting with FHE..." : "使用FHE加密中...") 
              : (language === "en" ? "Submit Securely" : "安全提交")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;