"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useSession } from "next-auth/react";

const StaffDataContext = createContext({});

// Cache for staff data to prevent duplicate API calls
const staffDataCache = new Map();

// Cache timeout in milliseconds (10 minutes)
const CACHE_TIMEOUT = 10 * 60 * 1000;

export function StaffDataProvider({ children }) {
  const { data: session } = useSession();
  const [staffData, setStaffData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(null);

  // staff2 returns a FLAT record (s.* + u.name/email/image/cv/gender/category),
  // including user_id since the SELECT does s.*. Wrap it as { profile: ... }
  // so consumers (StaffProfile, EditProfile) can read staffData.profile.* the
  // same way they used to read facultyData.profile.*.
  const wrapAsProfile = (flatRecord) => ({ profile: flatRecord });

  const setupAutoRefresh = (userEmail) => {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
    }
    const interval = setInterval(() => {
      console.log("[StaffDataContext] Auto-refreshing data after 10 minutes");
      refreshStaffData();
    }, CACHE_TIMEOUT);
    setAutoRefreshInterval(interval);
    return interval;
  };

  useEffect(() => {
    return () => {
      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
      }
    };
  }, [autoRefreshInterval]);

  useEffect(() => {
    if (!session?.user?.email) {
      setLoading(false);
      return;
    }

    const userEmail = session.user.email;
    console.log("[StaffDataContext] Initializing for user:", userEmail);

    const trySessionStorage = () => {
      if (typeof window !== "undefined") {
        try {
          const storageKey = `staff_data_${userEmail}`;
          const storedData = sessionStorage.getItem(storageKey);

          if (storedData) {
            const { data, timestamp } = JSON.parse(storedData);
            const now = Date.now();

            if (now - timestamp < CACHE_TIMEOUT) {
              console.log(
                "[StaffDataContext] Using session storage cache for:",
                userEmail,
              );
              setStaffData(data);
              staffDataCache.set(userEmail, { data, timestamp });
              setLastFetchTime(timestamp);
              setLoading(false);

              const remainingTime = CACHE_TIMEOUT - (now - timestamp);
              setTimeout(() => {
                setupAutoRefresh(userEmail);
              }, remainingTime);

              return true;
            }

            console.log("[StaffDataContext] Cache expired for:", userEmail);
          }
        } catch (err) {
          console.error(
            "[StaffDataContext] Error accessing session storage:",
            err,
          );
        }
      }
      return false;
    };

    if (staffDataCache.has(userEmail)) {
      const { data, timestamp } = staffDataCache.get(userEmail);
      const now = Date.now();

      if (now - timestamp < CACHE_TIMEOUT) {
        console.log("[StaffDataContext] Using memory cache for:", userEmail);
        setStaffData(data);
        setLastFetchTime(timestamp);
        setLoading(false);

        const remainingTime = CACHE_TIMEOUT - (now - timestamp);
        setTimeout(() => {
          setupAutoRefresh(userEmail);
        }, remainingTime);

        return;
      }

      console.log("[StaffDataContext] Memory cache expired for:", userEmail);
    }

    if (trySessionStorage()) {
      return;
    }

    const fetchStaffData = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log("[StaffDataContext] Fetching staff data for:", userEmail);
        const startTime = performance.now();

        // staff2's GET supports ?email= lookup (added alongside user_id and
        // employee_code) and always includes user_id in the flat response
        // since the SELECT does s.*.
        const response = await fetch(
          `/api/staff2?email=${encodeURIComponent(userEmail)}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
            cache: "no-store",
          },
        );

        if (!response.ok) {
          if (response.status === 404) {
            console.log("[StaffDataContext] Staff not found for:", userEmail);
            setStaffData(null);
            return;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const flatRecord = await response.json();
        const data = wrapAsProfile(flatRecord);
        const endTime = performance.now();
        const now = Date.now();

        console.log(
          `[StaffDataContext] Staff data fetched in ${endTime - startTime}ms`,
        );
        console.log("[StaffDataContext] Profile data:", data.profile);
        console.log(
          "[StaffDataContext] user_id present:",
          !!data.profile?.user_id,
        );

        staffDataCache.set(userEmail, { data, timestamp: now });

        if (typeof window !== "undefined") {
          try {
            const storageKey = `staff_data_${userEmail}`;
            sessionStorage.setItem(
              storageKey,
              JSON.stringify({ data, timestamp: now }),
            );
          } catch (err) {
            console.error(
              "[StaffDataContext] Error storing in session storage:",
              err,
            );
          }
        }

        setStaffData(data);
        setLastFetchTime(now);

        setupAutoRefresh(userEmail);
      } catch (err) {
        console.error("[StaffDataContext] Error fetching staff data:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStaffData();
  }, [session?.user?.email]);

  const refreshStaffData = async () => {
    if (!session?.user?.email) return;

    const userEmail = session.user.email;
    staffDataCache.delete(userEmail);

    if (typeof window !== "undefined") {
      try {
        const storageKey = `staff_data_${userEmail}`;
        sessionStorage.removeItem(storageKey);
      } catch (err) {
        console.error(
          "[StaffDataContext] Error clearing session storage:",
          err,
        );
      }
    }

    setLoading(true);
    try {
      console.log(
        "[StaffDataContext] Force refreshing staff data for:",
        userEmail,
      );
      const response = await fetch(
        `/api/staff2?email=${encodeURIComponent(userEmail)}`,
        {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          console.log("[StaffDataContext] Staff not found for:", userEmail);
          setStaffData(null);
          return;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const flatRecord = await response.json();
      const data = wrapAsProfile(flatRecord);
      const now = Date.now();

      console.log("[StaffDataContext] Refreshed profile data:", data.profile);

      staffDataCache.set(userEmail, { data, timestamp: now });

      if (typeof window !== "undefined") {
        try {
          const storageKey = `staff_data_${userEmail}`;
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ data, timestamp: now }),
          );
        } catch (err) {
          console.error(
            "[StaffDataContext] Error storing in session storage:",
            err,
          );
        }
      }

      setStaffData(data);
      setLastFetchTime(now);

      setupAutoRefresh(userEmail);
    } catch (err) {
      setError(err.message);
      console.error("[StaffDataContext] Error refreshing staff data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Function to update specific data section (e.g. after a successful edit,
  // so UI reflects the change without waiting for a refetch)
  const updateStaffSection = (sectionName, newData) => {
    if (!staffData) return;

    const updatedData = {
      ...staffData,
      [sectionName]: newData,
    };

    setStaffData(updatedData);

    if (session?.user?.email) {
      const now = Date.now();
      staffDataCache.set(session.user.email, {
        data: updatedData,
        timestamp: now,
      });

      if (typeof window !== "undefined") {
        try {
          const storageKey = `staff_data_${session.user.email}`;
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ data: updatedData, timestamp: now }),
          );
        } catch (err) {
          console.error(
            "[StaffDataContext] Error updating session storage:",
            err,
          );
        }
      }
    }
  };

  const getBasicInfo = () => {
    const info = staffData?.profile || {};
    console.log("[StaffDataContext] getBasicInfo called, returning:", info);
    return info;
  };

  const value = {
    staffData,
    loading,
    error,
    lastFetchTime,
    refreshStaffData,
    updateStaffSection,
    getBasicInfo,
  };

  return (
    <StaffDataContext.Provider value={value}>
      {children}
    </StaffDataContext.Provider>
  );
}

export function useStaffData() {
  const context = useContext(StaffDataContext);
  if (context === undefined) {
    throw new Error("useStaffData must be used within a StaffDataProvider");
  }
  return context;
}

export function useStaffSection(sectionName) {
  const { staffData, loading, error } = useStaffData();

  return {
    data: staffData?.[sectionName] || [],
    loading,
    error,
  };
}
