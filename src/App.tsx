/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Plus, User, Home, MessageSquare, MapPin, 
  Filter, Heart, Share2, Phone, Star, Camera, Bell,
  CheckCircle2, AlertCircle, Loader2, Sparkles, X,
  ChevronLeft, ChevronRight, ShoppingBag, Check, CheckCheck,
  Settings, Calendar, Save, Copy, ExternalLink, LogOut, Ban
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser, sendEmailVerification 
} from 'firebase/auth';
import { 
  collection, query, where, orderBy, getDocs, addDoc, 
  serverTimestamp, updateDoc, doc, getDoc, onSnapshot, limit, setDoc, deleteDoc,
  runTransaction
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType, messaging, getToken, onMessage } from './lib/firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Ad {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  condition: string;
  images: string[];
  location: { lat: number; lng: number; city: string };
  sellerId: string;
  sellerName: string;
  contactMethod: 'whatsapp' | 'chat';
  whatsappNumber?: string;
  createdAt: any;
  status: 'active' | 'sold' | 'deleted';
}

interface UserProfile {
  displayName: string;
  photoURL: string;
  email: string;
  whatsappNumber?: string;
  phoneNumber?: string;
  address?: string;
  birthDate?: string;
  fcmToken?: string;
}

interface Conversation {
  id: string;
  participants: string[];
  adId: string;
  adTitle: string;
  lastMessage: string;
  lastMessageAt: any;
  unreadCount?: Record<string, number>;
  typing?: Record<string, boolean>;
  otherUser?: {
    displayName: string;
    photoURL: string;
  };
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  read?: boolean;
  createdAt: any;
}

// --- Components ---

// --- Helper Functions ---

async function compressImage(base64Str: string, maxWidth = 800, maxHeight = 800, quality = 0.7): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
}

function ConfirmModal({ isOpen, onClose, onConfirm, title, message, children, confirmText = "تأكيد", cancelText = "إلغاء", isDestructive = false, type = "danger" }: any) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-white rounded-[32px] p-8 max-w-sm w-full shadow-2xl space-y-6"
      >
        <div className="space-y-2 text-center">
          <h3 className="text-xl font-serif font-bold text-brand-primary">{title}</h3>
          {message && <p className="text-sm text-brand-secondary leading-relaxed">{message}</p>}
        </div>
        
        {children}

        <div className="flex flex-col gap-2 pt-4">
          <button 
            onClick={() => { onConfirm(); onClose(); }}
            className={cn(
              "w-full py-4 rounded-2xl font-bold transition-all active:scale-95",
              type === "info" ? "bg-brand-primary text-white" : "bg-red-500 text-white shadow-lg shadow-red-500/20"
            )}
          >
            {confirmText}
          </button>
          <button 
            onClick={onClose}
            className="w-full py-4 rounded-2xl font-bold text-brand-secondary hover:bg-brand-muted transition-all"
          >
            {cancelText}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const CATEGORIES = [
  { id: 'electronics', label: 'إلكترونيات', icon: '📱' },
  { id: 'cars', label: 'سيارات', icon: '🚗' },
  { id: 'furniture', label: 'أثاث', icon: '🪑' },
  { id: 'fashion', label: 'ملابس', icon: '👕' },
  { id: 'realestate', label: 'عقارات', icon: '🏠' },
  { id: 'services', label: 'خدمات', icon: '🛠️' },
];

const CITIES = ['الكل', 'بغداد', 'البصرة', 'الموصل', 'أربيل', 'النجف', 'كربلاء', 'كركوك', 'الناصرية', 'السليمانية'];

const SORT_OPTIONS = [
  { id: 'newest', label: 'الأحدث أولاً' },
  { id: 'price_asc', label: 'السعر: من الأقل' },
  { id: 'price_desc', label: 'السعر: من الأعلى' },
];

const CONDITIONS = [
  { id: 'new', label: 'جديد' },
  { id: 'excellent', label: 'مستعمل كأنه جديد' },
  { id: 'good', label: 'مستعمل بحالة جيدة' },
  { id: 'fair', label: 'مستعمل مقبول' },
];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [view, setView] = useState<'home' | 'details' | 'create' | 'profile' | 'sellerProfile' | 'chats' | 'chatroom' | 'myAds' | 'notifications' | 'blocks' | 'favorites'>('home');
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);

  const [activeChat, setActiveChat] = useState<Conversation | null>(null);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeCondition, setActiveCondition] = useState<string | null>(null);
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  // Helper for notifications
  const createNotification = async (userId: string, title: string, message: string, type: string, data: any = {}) => {
    try {
      // 1. Create In-App Notification
      await addDoc(collection(db, 'notifications'), {
        userId,
        title,
        message,
        type,
        data,
        read: false,
        createdAt: serverTimestamp()
      });

      // 2. Send Push Notification if token exists
      const recipientSnap = await getDoc(doc(db, 'users', userId));
      if (recipientSnap.exists()) {
        const recipientData = recipientSnap.data();
        if (recipientData.fcmToken) {
          await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: recipientData.fcmToken,
              title,
              body: message,
              data
            })
          });
        }
      }
    } catch (e) {
      console.error('Error creating notification:', e);
    }
  };

  // Monitor blocked users
  useEffect(() => {
    if (!user) {
      setBlockedUsers([]);
      return;
    }
    const q = collection(db, 'users', user.uid, 'blocks');
    return onSnapshot(q, (snapshot) => {
      setBlockedUsers(snapshot.docs.map(doc => doc.id));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/blocks`);
    });
  }, [user]);

  // Monitor favorites
  useEffect(() => {
    if (!user) {
      setFavorites([]);
      return;
    }
    const q = collection(db, 'users', user.uid, 'favorites');
    return onSnapshot(q, (snapshot) => {
      setFavorites(snapshot.docs.map(doc => doc.data().adId));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/favorites`);
    });
  }, [user]);

  const toggleFavorite = async (adId: string) => {
    if (!user) {
      // Prompt login or similar
      return;
    }
    const isFavorited = favorites.includes(adId);
    const favRef = doc(db, 'users', user.uid, 'favorites', adId);

    try {
      if (isFavorited) {
        await deleteDoc(favRef);
      } else {
        await setDoc(favRef, {
          adId,
          createdAt: serverTimestamp()
        });
      }
    } catch (e) {
      handleFirestoreError(e, isFavorited ? OperationType.DELETE : OperationType.WRITE, `users/${user.uid}/favorites/${adId}`);
    }
  };

  // Monitor unread notifications
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'notifications'), where('userId', '==', user.uid), where('read', '==', false));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUnreadNotifications(snapshot.size);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'notifications');
    });
    return () => unsubscribe();
  }, [user]);

  // Monitor chats
  useEffect(() => {
    if (!user) {
      setChats([]);
      return;
    }
    const q = query(
      collection(db, 'chats'), 
      where('participants', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc')
    );
    
    return onSnapshot(q, async (snapshot) => {
      const chatList = await Promise.all(snapshot.docs.map(async (chatDoc) => {
        const data = chatDoc.data() as Conversation;
        const otherUserId = data.participants.find(p => p !== user.uid);
        let otherUser = { displayName: 'مستخدم', photoURL: '' };
        
        if (otherUserId) {
          const userSnap = await getDoc(doc(db, 'users', otherUserId));
          if (userSnap.exists()) {
            const userData = userSnap.data();
            otherUser = { displayName: userData.displayName, photoURL: userData.photoURL };
          }
        }
        
        return { id: chatDoc.id, ...data, otherUser } as Conversation;
      }));
      setChats(chatList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });
  }, [user]);

  // --- Auth & Profile ---
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          const newProfile = {
            displayName: u.displayName || 'مستخدم جديد',
            photoURL: u.photoURL || '',
            email: u.email || '',
            createdAt: serverTimestamp(),
          };
          await setDoc(userRef, newProfile);
          setProfile(newProfile as any);
        } else {
          setProfile(userSnap.data() as UserProfile);
        }

        // --- FCM Registration ---
        if (messaging) {
          try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              const token = await getToken(messaging, {
                vapidKey: (import.meta as any).env.VITE_VAPID_KEY
              });
              if (token) {
                await updateDoc(userRef, { fcmToken: token });
                console.log('FCM Token registered');
              }
            }
          } catch (error) {
            console.error('Notification error:', error);
          }
        }
      } else {
        setProfile(null);
      }
    });
  }, []);

  // Listen for foreground messages
  useEffect(() => {
    if (messaging) {
      const unsubscribe = onMessage(messaging, (payload) => {
        console.log('Foreground message received:', payload);
        if (payload.notification) {
          setToast({ 
            title: payload.notification.title || 'إشعار جديد', 
            body: payload.notification.body || '' 
          });
          setTimeout(() => setToast(null), 5000);
        }
      });
      return () => unsubscribe();
    }
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => setShowLogoutConfirm(true);
  const confirmLogout = () => {
    signOut(auth);
    setShowLogoutConfirm(false);
    setView('home');
  };

  // --- Data Fetching ---
  useEffect(() => {
    setLoading(true);
    let q = query(collection(db, 'ads'), where('status', '==', 'active'), orderBy('createdAt', 'desc'), limit(20));
    
    if (activeCategory) {
      q = query(collection(db, 'ads'), where('status', '==', 'active'), where('category', '==', activeCategory), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const adsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Ad[];
      setAds(adsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'ads');
    });

    return () => unsubscribe();
  }, [activeCategory]);

  const filteredAds = useMemo(() => {
    let result = ads.filter(ad => {
      const matchesSearch = ad.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           ad.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCondition = activeCondition ? ad.condition === activeCondition : true;
      const matchesCity = activeCity && activeCity !== 'الكل' ? ad.location.city === activeCity : true;
      const notBlocked = !user || !blockedUsers.includes(ad.sellerId);
      return matchesSearch && matchesCondition && matchesCity && notBlocked;
    });

    // Sorting
    return [...result].sort((a, b) => {
      if (sortBy === 'price_asc') return a.price - b.price;
      if (sortBy === 'price_desc') return b.price - a.price;
      // Default to newest
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
      return dateB.getTime() - dateA.getTime();
    });
  }, [ads, searchQuery, activeCondition, activeCity, sortBy, blockedUsers, user]);

  const filteredChats = useMemo(() => {
    if (!user) return [];
    return chats.filter(chat => {
      const otherId = chat.participants.find((p: string) => p !== user.uid);
      return !blockedUsers.includes(otherId);
    });
  }, [chats, blockedUsers, user]);

  // --- View Helpers ---
  const showAdDetails = (ad: Ad) => {
    setSelectedAd(ad);
    setView('details');
  };

  const startChat = async (ad: Ad) => {
    if (!user) {
      handleLogin();
      return;
    }
    if (user.uid === ad.sellerId) return;

    // Check if chat already exists
    const chatsRef = collection(db, 'chats');
    const q = query(
      chatsRef, 
      where('participants', 'array-contains', user.uid),
      where('adId', '==', ad.id)
    );
    const snap = await getDocs(q);
    
    let chat: Conversation;
    if (!snap.empty) {
      chat = { id: snap.docs[0].id, ...snap.docs[0].data() } as Conversation;
    } else {
      const newChat: Omit<Conversation, 'id'> = {
        participants: [user.uid, ad.sellerId],
        adId: ad.id,
        adTitle: ad.title,
        lastMessage: 'بدء المحادثة',
        lastMessageAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, 'chats'), newChat);
      chat = { id: docRef.id, ...newChat } as Conversation;
    }
    
    setActiveChat(chat);
    setView('chatroom');
  };

  const markAsSold = async () => {
    if (!selectedAd || !user || selectedAd.sellerId !== user.uid) return;
    try {
      await updateDoc(doc(db, 'ads', selectedAd.id), { status: 'sold' });
      setSelectedAd({ ...selectedAd, status: 'sold' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `ads/${selectedAd.id}`);
    }
  };

  // --- UI Renderers ---
  return (
    <div className="min-h-screen pb-20 flex flex-col w-full bg-white relative overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-brand-border px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black flex items-center justify-center rounded-sm">
              <ShoppingBag className="text-white w-4 h-4" />
            </div>
            <h1 className="text-lg font-black tracking-tighter text-black uppercase">الرافدين</h1>
          </div>
          
          <div className="flex-1" />

          {user && (
            <button 
              onClick={() => setView('notifications')}
              className="p-2 mr-2 text-brand-secondary relative hover:bg-brand-muted rounded-full transition-all"
            >
              <Bell className={cn("w-6 h-6", unreadNotifications > 0 && "text-red-500 fill-red-500")} />
              {unreadNotifications > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full font-bold border-2 border-white">
                  {unreadNotifications}
                </span>
              )}
            </button>
          )}

          {user ? (
            <button 
              onClick={() => setView('profile')}
              className="w-10 h-10 rounded-full overflow-hidden border border-brand-border shrink-0 hover:border-brand-primary transition-colors"
            >
              {profile?.photoURL || user.photoURL ? (
                <img src={profile?.photoURL || user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                  <User className="text-gray-400 w-5 h-5" />
                </div>
              )}
            </button>
          ) : (
            <button 
              onClick={handleLogin}
              className="text-sm font-medium bg-brand-primary text-white px-4 py-2 rounded-full hover:bg-brand-primary/90 transition-colors"
            >
              دخول
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <HomeView 
              activeCategory={activeCategory} 
              setActiveCategory={setActiveCategory}
              activeCondition={activeCondition}
              setActiveCondition={setActiveCondition}
              activeCity={activeCity}
              setActiveCity={setActiveCity}
              sortBy={sortBy}
              setSortBy={setSortBy}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              ads={filteredAds}
              loading={loading}
              onAdClick={showAdDetails}
              favorites={favorites}
              toggleFavorite={toggleFavorite}
            />
          )}

          {view === 'create' && (
            <CreateAdView 
              user={user} 
              onClose={() => setView('home')} 
              onSuccess={() => setView('home')} 
            />
          )}

          {view === 'details' && selectedAd && (
            <AdDetailsView 
              ad={selectedAd} 
              onBack={() => setView('home')} 
              onStartChat={() => startChat(selectedAd)}
              currentUser={user}
              profile={profile}
              blockedUsers={blockedUsers}
              createNotification={createNotification}
              isFavorited={favorites.includes(selectedAd.id)}
              onToggleFavorite={() => toggleFavorite(selectedAd.id)}
              onViewProfile={(sellerId: string) => {
                setViewingProfileId(sellerId);
                setView('sellerProfile');
              }}
            />
          )}

          {view === 'sellerProfile' && viewingProfileId && (
            <SellerProfileView 
              userId={viewingProfileId}
              onBack={() => {
                if (viewingProfileId === user?.uid) {
                  setView('profile');
                } else {
                  setView('details');
                }
              }}
              onAdClick={showAdDetails}
              onStartChat={(ad: Ad) => startChat(ad)}
              currentUser={user}
            />
          )}


          {view === 'myAds' && user && (
            <MyAdsView 
              user={user}
              onBack={() => setView('profile')}
              onAdClick={showAdDetails}
            />
          )}

          {view === 'favorites' && user && (
            <FavoritesView 
              favorites={favorites}
              onBack={() => setView('home')}
              onAdClick={showAdDetails}
              onToggleFavorite={toggleFavorite}
            />
          )}

          {view === 'notifications' && user && (
            <NotificationsView 
              onBack={() => setView('profile')} 
            />
          )}

          {view === 'blocks' && user && (
            <BlockedUsersView 
              user={user} 
              blockedUsers={blockedUsers}
              onBack={() => setView('profile')} 
            />
          )}

          {view === 'profile' && user && (
            <ProfileView 
              user={user} 
              profile={profile}
              blockedUsers={blockedUsers}
              unreadNotifications={unreadNotifications}
              onLogout={handleLogout}
              onBack={() => setView('home')}
              onViewMyAds={() => setView('myAds')}
              onViewNotifications={() => setView('notifications')}
              onViewBlocked={() => setView('blocks')}
              onViewFavorites={() => setView('favorites')}
            />
          )}

          {view === 'chats' && user && (
            <ChatListView 
              user={user}
              onChatSelect={(chat: Conversation) => {
                setActiveChat(chat);
                setView('chatroom');
              }}
              chats={filteredChats}
            />
          )}

          {view === 'chatroom' && user && activeChat && (
            <ChatRoomView 
              user={user}
              chat={activeChat}
              onBack={() => setView('chats')}
              blockedUsers={blockedUsers}
              createNotification={createNotification}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Bar */}
          <nav className="fixed bottom-0 left-0 right-0 w-full bg-white/90 backdrop-blur-xl border-t border-brand-border py-4 px-6 flex justify-center items-center z-40 lg:px-20 lg:py-6 shadow-sm">
        <div className="flex justify-between items-center w-full max-w-md lg:max-w-xl mx-auto">
          <NavButton active={view === 'home'} onClick={() => setView('home')} icon={<Home />} label="الرئيسية" />
          <NavButton active={view === 'chats'} onClick={() => user ? setView('chats') : handleLogin()} icon={<MessageSquare />} label="الرسائل" />
          <button 
            onClick={() => user ? setView('create') : handleLogin()}
            className="w-14 h-14 bg-brand-primary text-white rounded-2xl flex items-center justify-center shadow-lg shadow-brand-primary/20 -translate-y-6 hover:scale-105 active:scale-95 transition-all lg:w-16 lg:h-16 lg:-translate-y-8"
          >
            <Plus className="w-8 h-8 lg:w-10 lg:h-10" />
          </button>
          <div className="relative">
            <NavButton active={view === 'profile'} onClick={() => user ? setView('profile') : handleLogin()} icon={<User />} label="حسابي" />
            {unreadNotifications > 0 && (
              <div className="absolute right-1/2 translate-x-4 top-1 w-2 h-2 bg-red-500 rounded-full border border-white shadow-sm z-50 pointer-events-none" />
            )}
          </div>
        </div>
      </nav>

      <AnimatePresence>
        {showLogoutConfirm && (
          <LogoutConfirmModal 
            isOpen={showLogoutConfirm}
            onClose={() => setShowLogoutConfirm(false)}
            onConfirm={confirmLogout}
          />
        )}
      </AnimatePresence>

      {/* Foreground Notification Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="fixed top-20 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm"
          >
            <div className="bg-white border-2 border-brand-primary p-4 rounded-[24px] shadow-2xl flex items-start gap-3">
              <div className="w-10 h-10 bg-brand-primary/10 rounded-full flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-brand-primary" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-sm text-brand-primary">{toast.title}</h4>
                <p className="text-xs text-brand-secondary line-clamp-2">{toast.body}</p>
              </div>
              <button onClick={() => setToast(null)} className="p-1 text-brand-secondary hover:bg-brand-muted rounded-full">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Chat Subviews ---

function ChatListView({ user, onChatSelect, chats }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 bg-brand-bg min-h-screen"
    >
      <h2 className="text-2xl font-serif font-bold text-[#444432] mb-8">الرسائل</h2>
      
      {chats.length > 0 ? (
        <div className="space-y-4">
          {chats.map((chat: any) => (
            <button 
              key={chat.id}
              onClick={() => onChatSelect(chat)}
              className="w-full flex items-center gap-4 bg-white p-4 rounded-[28px] border border-brand-border shadow-sm hover:bg-brand-muted transition-all active:scale-[0.98]"
            >
              <div className="w-14 h-14 rounded-full bg-brand-muted shrink-0 overflow-hidden border border-brand-border">
                {chat.otherUser?.photoURL ? (
                  <img src={chat.otherUser.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><User className="text-brand-secondary" /></div>
                )}
              </div>
              <div className="flex-1 text-right overflow-hidden">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-serif font-bold text-[#444432]">{chat.otherUser?.displayName}</span>
                  <span className="text-[10px] text-brand-secondary">
                    {chat.lastMessageAt?.toDate ? chat.lastMessageAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                  </span>
                </div>
                <p className="text-xs text-brand-secondary truncate">{chat.lastMessage}</p>
                <p className="text-[10px] text-brand-primary font-bold mt-1">بخصوص: {chat.adTitle}</p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 opacity-50">
          <MessageSquare className="w-12 h-12 mx-auto mb-4" />
          <p>ليس لديك محادثات حالياً</p>
        </div>
      )}
    </motion.div>
  );
}

function ChatRoomView({ user, chat, onBack, blockedUsers, createNotification }: any) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const typingTimeoutRef = React.useRef<any>(null);

  const otherUserId = chat.participants.find((p: string) => p !== user.uid);
  const isBlocked = blockedUsers?.includes(otherUserId);
  const [isBlocking, setIsBlocking] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  const toggleBlockUser = async () => {
    if (!user || !otherUserId) return;
    
    setIsBlocking(true);
    try {
      const blockRef = doc(db, 'users', user.uid, 'blocks', otherUserId);
      if (isBlocked) {
        await deleteDoc(blockRef);
      } else {
        await setDoc(blockRef, {
          blockedUserId: otherUserId,
          createdAt: serverTimestamp()
        });
        onBack();
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}/blocks/${otherUserId}`);
    } finally {
      setIsBlocking(false);
    }
  };

  // Typing status effect
  useEffect(() => {
    const q = doc(db, 'chats', chat.id);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const otherUserId = chat.participants.find((p: string) => p !== user.uid);
        if (otherUserId && data.typing) {
          setIsOtherTyping(!!data.typing[otherUserId]);
        }
      }
    });
    return () => {
      unsubscribe();
      // Clean up typing status on exit
      updateDoc(doc(db, 'chats', chat.id), {
        [`typing.${user.uid}`]: false
      }).catch(() => {});
    };
  }, [chat.id, user.uid]);

  // Read receipts effect
  useEffect(() => {
    if (messages.length > 0) {
      const unreadFromOther = messages.filter(m => m.senderId !== user.uid && !m.read);
      unreadFromOther.forEach(msg => {
        updateDoc(doc(db, 'chats', chat.id, 'messages', msg.id), { read: true })
          .catch(e => console.error("Error marking read:", e));
      });
    }
  }, [messages, chat.id, user.uid]);

  useEffect(() => {
    const q = query(
        collection(db, 'chats', chat.id, 'messages'),
        orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Message[];
        setMessages(msgs);
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `chats/${chat.id}/messages`);
    });
    return () => unsubscribe();
  }, [chat.id]);

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    // Set typing: true
    updateDoc(doc(db, 'chats', chat.id), {
      [`typing.${user.uid}`]: true
    }).catch(() => {});

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      updateDoc(doc(db, 'chats', chat.id), {
        [`typing.${user.uid}`]: false
      }).catch(() => {});
    }, 3000);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;
    setSending(true);

    try {
        const text = newMessage;
        setNewMessage('');
        
        // Stop typing status instantly
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        await updateDoc(doc(db, 'chats', chat.id), {
          [`typing.${user.uid}`]: false
        });
        
        await addDoc(collection(db, 'chats', chat.id, 'messages'), {
            senderId: user.uid,
            text,
            read: false,
            createdAt: serverTimestamp()
        });

        await updateDoc(doc(db, 'chats', chat.id), {
            lastMessage: text,
            lastMessageAt: serverTimestamp()
        });

        const otherUserId = chat.participants.find((p: string) => p !== user.uid);
        if (otherUserId) {
          await createNotification(
            otherUserId, 
            `رسالة جديدة من ${user.displayName}`, 
            text, 
            'chat', 
            { chatId: chat.id }
          );
        }
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `chats/${chat.id}/messages`);
    } finally {
        setSending(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="fixed inset-0 z-50 bg-brand-bg flex flex-col max-w-md mx-auto"
    >
      {/* Chat Header */}
      <div className="bg-white p-4 border-b border-brand-border flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-brand-muted rounded-full transition-colors">
            <ChevronRight className="w-6 h-6 text-brand-primary" />
          </button>
          <div className="w-10 h-10 rounded-full overflow-hidden border border-brand-border">
            <img src={chat.otherUser?.photoURL || `https://ui-avatars.com/api/?name=${chat.otherUser?.displayName}&background=5A5A40&color=fff`} alt="" />
          </div>
          <div>
            <h3 className="font-serif font-bold text-[#444432]">{chat.otherUser?.displayName}</h3>
            <div className="flex items-center gap-1">
              {isOtherTyping ? (
                <span className="text-[10px] text-brand-primary font-bold animate-pulse">يكتب الآن...</span>
              ) : (
                <p className="text-[10px] text-brand-primary font-bold">بخصوص: {chat.adTitle}</p>
              )}
            </div>
          </div>
        </div>
        <button 
          onClick={() => setShowBlockConfirm(true)}
          disabled={isBlocking}
          className="p-2 hover:bg-red-50 text-brand-secondary hover:text-red-500 rounded-full transition-colors"
          title={isBlocked ? "إلغاء الحظر" : "حظر المستخدم"}
        >
          {isBlocking ? <Loader2 className="w-5 h-5 animate-spin" /> : <Ban className="w-5 h-5" />}
        </button>
      </div>

      <ConfirmModal 
        isOpen={showBlockConfirm}
        onClose={() => setShowBlockConfirm(false)}
        onConfirm={toggleBlockUser}
        title={isBlocked ? "إلغاء الحظر" : "حظر المستخدم"}
        message={isBlocked ? "هل تريد إلغاء حظر هذا المستخدم؟" : "هل أنت متأكد أنك تريد حظر هذا المستخدم؟ لن تظهر لك رسائله ولن تتمكن من مراسلته."}
        confirmText={isBlocked ? "إلغاء الحظر" : "حظر المستخدم"}
        isDestructive={!isBlocked}
      />

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
        {messages.map((msg) => (
          <div 
            key={msg.id}
            className={cn(
              "flex flex-col max-w-[80%]",
              msg.senderId === user.uid ? "mr-auto items-start" : "ml-auto items-end"
            )}
          >
            <div className={cn(
              "px-4 py-3 rounded-[24px] text-sm shadow-sm relative group",
              msg.senderId === user.uid 
                ? "bg-brand-primary text-white rounded-br-none" 
                : "bg-white border border-brand-border text-[#444432] rounded-bl-none"
            )}>
              {msg.text}
            </div>
            <div className={cn(
              "flex items-center gap-1 mt-1 px-1",
              msg.senderId === user.uid ? "flex-row" : "flex-row-reverse"
            )}>
              <span className="text-[9px] text-brand-secondary">
                {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              {msg.senderId === user.uid && (
                <span className="flex">
                  {msg.read ? (
                    <CheckCheck className="w-2.5 h-2.5 text-brand-primary" />
                  ) : (
                    <Check className="w-2.5 h-2.5 text-brand-secondary" />
                  )}
                </span>
              )}
            </div>
          </div>
        ))}
        {isOtherTyping && (
          <div className="flex items-center gap-2 ml-auto">
            <div className="bg-white border border-brand-border px-3 py-2 rounded-[20px] rounded-bl-none flex gap-1">
              <span className="w-1.5 h-1.5 bg-brand-secondary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-1.5 bg-brand-secondary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-1.5 bg-brand-secondary rounded-full animate-bounce"></span>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-brand-border">
        <form onSubmit={sendMessage} className="flex gap-2">
          <input 
            type="text" 
            placeholder="اكتب رسالتك هنا..."
            value={newMessage}
            onChange={handleTyping}
            className="flex-1 bg-brand-muted border-none rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-brand-primary/20 outline-none"
          />
          <button 
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="w-12 h-12 bg-brand-primary text-white rounded-full flex items-center justify-center shadow-lg shadow-brand-primary/20 disabled:opacity-50 transition-all"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronLeft className="w-6 h-6" />}
          </button>
        </form>
      </div>
    </motion.div>
  );
}

// --- Subviews ---

function HomeView({ 
  activeCategory, setActiveCategory, 
  activeCondition, setActiveCondition,
  activeCity, setActiveCity,
  sortBy, setSortBy,
  searchQuery, setSearchQuery, ads, loading, onAdClick,
  favorites, toggleFavorite
}: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-4"
    >
      <div className="max-w-6xl mx-auto space-y-16 px-4">
        {/* Simplified Header/Search */}
        <div className="pt-8 text-center space-y-6">
          <h2 className="text-3xl font-black text-black lg:text-5xl">سوق عراقي عصري.</h2>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="ابحث عن أي شيء..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-brand-muted border border-brand-border rounded-lg py-4 pr-11 pl-4 text-sm focus:border-black outline-none transition-all"
            />
          </div>
        </div>

        {/* Categories Grid - Minimalist */}
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
              className={cn(
                "flex flex-col items-center gap-2 p-2 rounded-lg transition-all",
                activeCategory === cat.id ? "bg-black text-white" : "hover:bg-brand-muted opacity-60 hover:opacity-100"
              )}
            >
              <div className="text-xl">{cat.icon}</div>
              <span className="text-[10px] font-bold uppercase tracking-widest">{cat.label}</span>
            </button>
          ))}
        </div>

        {/* Content Section */}
        <div className="space-y-8">
          <div className="flex items-center justify-between border-b border-brand-border pb-4">
            <h3 className="text-xs font-black uppercase tracking-[0.2em]">آخر الإعلانات</h3>
            <div className="flex items-center gap-4">
              <select 
                value={activeCity || ''}
                onChange={(e) => setActiveCity(e.target.value)}
                className="text-[10px] font-bold bg-transparent outline-none cursor-pointer uppercase opacity-40 hover:opacity-100 transition-opacity"
              >
                <option value="">كل العراق</option>
                {CITIES.map(city => <option key={`home-city-${city}`} value={city}>{city}</option>)}
              </select>
            </div>
          </div>

          <div className="pb-24">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : ads.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-12">
                {ads.map((ad: Ad) => (
                  <AdCard 
                    key={`home-ad-${ad.id}`} 
                    ad={ad} 
                    onClick={() => onAdClick(ad)} 
                    isFavorited={favorites.includes(ad.id)}
                    onToggleFavorite={() => toggleFavorite(ad.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center opacity-30">
                <ShoppingBag className="w-6 h-6 mx-auto mb-2" />
                <p className="text-xs font-bold uppercase tracking-widest">لا توجد إعلانات</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function CreateAdView({ user, onClose, onSuccess }: any) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    category: 'electronics',
    condition: 'excellent',
    whatsappNumber: '',
  });
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string, 1024, 1024, 0.7);
        setImages((prev) => [...prev, compressed]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (images.length === 0) {
      alert('يرجى إضافة صورة واحدة على الأقل');
      return;
    }
    setSubmitting(true);

    try {
      const adData: Omit<Ad, 'id'> = {
        title: formData.title,
        description: formData.description,
        price: Number(formData.price),
        category: formData.category,
        condition: formData.condition,
        images: images,
        location: { lat: 33.3152, lng: 44.3661, city: 'بغداد' },
        sellerId: user.uid,
        sellerName: user.displayName || 'بائع',
        contactMethod: 'whatsapp',
        whatsappNumber: formData.whatsappNumber,
        createdAt: serverTimestamp(),
        status: 'active'
      };

      await addDoc(collection(db, 'ads'), adData);
      onSuccess();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'ads');
    } finally {
      setSubmitting(false);
    }
  };

  const getAiSuggestion = async () => {
    if (!formData.title) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/suggest-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemTitle: formData.title,
          category: formData.category,
          condition: formData.condition,
          itemDescription: formData.description
        })
      });
      const data = await res.json();
      setAiSuggestion(data);
    } catch (e) {
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="p-6 bg-white min-h-screen lg:pb-32"
    >
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-800">إضافة إعلان جديد</h2>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Image Upload Section */}
          <div className="space-y-4">
            <label className="text-sm font-bold text-brand-secondary">صور المنتج</label>
            <div className="flex flex-wrap gap-3">
              {images.map((img, idx) => (
                <div key={`up-img-${idx}`} className="relative w-24 h-24 rounded-xl overflow-hidden border border-brand-border shadow-sm group">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  <button 
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button 
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-24 h-24 rounded-xl border-2 border-dashed border-brand-border flex flex-col items-center justify-center gap-1 text-brand-secondary hover:bg-brand-muted transition-colors"
              >
                <Camera className="w-6 h-6" />
                <span className="text-[10px] font-bold">أضف صور</span>
              </button>
            </div>
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleImageChange}
              multiple
              accept="image/*"
              className="hidden"
            />
            <p className="text-[10px] text-brand-secondary opacity-60">يمكنك إضافة صور متعددة لإظهار تفاصيل المنتج.</p>
          </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-brand-secondary">عنوان الإعلان</label>
          <input 
            type="text" 
            placeholder="مثال: آيفون 13 برو ماكس نظيف جداً"
            required
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full bg-brand-muted border-none rounded-2xl p-4 focus:ring-2 focus:ring-brand-primary/20 transition-all outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-brand-secondary">السعر (دينار)</label>
            <input 
              type="number" 
              placeholder="0"
              required
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full bg-brand-muted border-none rounded-2xl p-4 focus:ring-2 focus:ring-brand-primary/20 outline-none"
            />
          </div>
          <div className="flex items-end pb-1">
            <button 
              type="button"
              onClick={getAiSuggestion}
              disabled={!formData.title || aiLoading}
              className="flex items-center gap-2 text-brand-primary bg-brand-primary/10 px-3 py-4 rounded-2xl font-bold w-full justify-center disabled:opacity-50 transition-all border border-brand-primary/20"
            >
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              سعر مقترح
            </button>
          </div>
        </div>

        {aiSuggestion && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-[#fdf8f0] p-5 rounded-3xl border border-[#ede3d1] shadow-sm"
          >
            <div className="flex items-center gap-2 text-[#8c6d31] font-bold text-sm mb-2">
              <Sparkles className="w-4 h-4" />
              مساعد التسعير الذكي
            </div>
            <p className="text-xl font-bold text-[#8c6d31] mb-2 font-serif">
              {aiSuggestion.minPrice.toLocaleString()} - {aiSuggestion.maxPrice.toLocaleString()} دينار
            </p>
            <p className="text-[11px] text-[#8c6d31] leading-relaxed opacity-80">{aiSuggestion.reasoning}</p>
          </motion.div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-700">القسم</label>
          <select 
            className="w-full bg-gray-50 border border-gray-100 rounded-xl p-4 focus:ring-2 focus:ring-brand-primary"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          >
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-700">الحالة</label>
          <select 
            className="w-full bg-gray-50 border border-gray-100 rounded-xl p-4 focus:ring-2 focus:ring-brand-primary"
            value={formData.condition}
            onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
          >
            {CONDITIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-700">وصف الغرض</label>
          <textarea 
            rows={4}
            placeholder="اكتب تفاصيل المنتج، العيوب إن وجدت، والملحقات..."
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full bg-gray-50 border border-gray-100 rounded-xl p-4 focus:ring-2 focus:ring-brand-primary"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-700">رقم الواتساب</label>
          <input 
            type="tel" 
            placeholder="07XXXXXXXX"
            value={formData.whatsappNumber}
            onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
            className="w-full bg-gray-50 border border-gray-100 rounded-xl p-4 focus:ring-2 focus:ring-brand-primary"
          />
        </div>

        {!user?.emailVerified && (
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-3xl flex items-center gap-3">
            <AlertCircle className="text-amber-600 w-5 h-5 shrink-0" />
            <p className="text-[11px] text-amber-900 font-bold">يرجى توثيق بريدك الإلكتروني من صفحة الحساب لتتمكن من نشر الإعلانات.</p>
          </div>
        )}

        <button 
          disabled={submitting || !user?.emailVerified}
          className="w-full bg-brand-primary text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-brand-primary/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
          نشر الإعلان
        </button>
      </form>
      </div>
    </motion.div>
  );
}

function ShareModal({ isOpen, onClose, ad }: { isOpen: boolean, onClose: () => void, ad: any }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/ad/${ad.id}`;
  const shareText = `تحقق من هذا الإعلان على سوق العراق: ${ad.title}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'سوق العراق',
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="relative w-full max-w-md bg-white rounded-t-[40px] sm:rounded-[40px] overflow-hidden shadow-2xl"
      >
        <div className="w-12 h-1.5 bg-brand-muted rounded-full mx-auto mt-4 mb-2 sm:hidden" />
        
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-2xl font-serif font-bold text-brand-primary">مشاركة الإعلان</h3>
              <p className="text-xs text-brand-secondary opacity-60">اختر المنصة لمشاركة هذا الإعلان</p>
            </div>
            <button onClick={onClose} className="p-3 bg-brand-muted text-brand-secondary rounded-2xl hover:bg-brand-primary/10 hover:text-brand-primary transition-all">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-gradient-to-br from-brand-muted to-white rounded-3xl p-5 mb-10 flex flex-col gap-5 border border-brand-border shadow-sm overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-40 h-40 bg-brand-primary/5 rounded-full -mr-20 -mt-20 blur-3xl transition-all group-hover:bg-brand-primary/10" />
            
            <div className="flex gap-5 relative z-10">
              <div className="w-24 h-24 rounded-2xl overflow-hidden shrink-0 shadow-md transform group-hover:scale-105 transition-transform duration-500">
                <img src={ad.images?.[0]} alt={ad.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <div className="flex flex-col justify-center overflow-hidden flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
                  <p className="text-[10px] font-black tracking-[0.2em] text-brand-primary/60 uppercase">سوق العراق</p>
                </div>
                <h4 className="font-serif font-bold text-brand-primary truncate text-xl mb-1">{ad.title}</h4>
                <p className="text-brand-primary font-black text-lg">{ad.price.toLocaleString()} <span className="text-[10px] opacity-40">د.ع</span></p>
              </div>
            </div>
            
            <div className="flex items-center justify-between mt-2 pt-4 border-t border-brand-border/30 relative z-10">
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-brand-secondary opacity-40" />
                <span className="text-xs font-bold text-brand-secondary/60">{ad.location.city}</span>
              </div>
              <div className="flex items-center gap-1.5 grayscale opacity-30">
                <div className="w-4 h-4 bg-brand-primary rounded-full" />
                <span className="text-[9px] font-black text-brand-primary uppercase tracking-widest">IRAQ MARKET</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5 mb-4">
            <button 
              onClick={handleCopy}
              className="flex flex-col items-center gap-4 p-5 bg-brand-muted rounded-[32px] hover:bg-brand-primary/5 transition-all group relative overflow-hidden"
            >
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-all">
                {copied ? <Check className="w-7 h-7 text-green-500" /> : <Copy className="w-7 h-7 text-brand-primary" />}
              </div>
              <span className="text-[11px] font-black uppercase tracking-widest text-brand-secondary">{copied ? 'تم النسخ' : 'نسخ الرابط'}</span>
              {copied && <motion.div layoutId="sparkle" className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full" />}
            </button>

            <a 
              href={`https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-4 p-5 bg-brand-muted rounded-[32px] hover:bg-brand-primary/5 transition-all group"
            >
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:-rotate-3 transition-all text-[#25D366]">
                <MessageSquare className="w-7 h-7 fill-current" />
              </div>
              <span className="text-[11px] font-black uppercase tracking-widest text-brand-secondary">واتساب</span>
            </a>

            <a 
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-4 p-5 bg-brand-muted rounded-[32px] hover:bg-brand-primary/5 transition-all group"
            >
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-all text-[#1877F2]">
                 <Share2 className="w-7 h-7" />
              </div>
              <span className="text-[11px] font-black uppercase tracking-widest text-brand-secondary">فيسبوك</span>
            </a>

            <button 
              onClick={handleNativeShare}
              className="flex flex-col items-center gap-4 p-5 bg-brand-muted rounded-[32px] hover:bg-brand-primary/5 transition-all group"
            >
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:-rotate-3 transition-all">
                <ExternalLink className="w-7 h-7 text-brand-primary" />
              </div>
              <span className="text-[11px] font-black uppercase tracking-widest text-brand-secondary">المزيد</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function LogoutConfirmModal({ isOpen, onClose, onConfirm }: { isOpen: boolean, onClose: () => void, onConfirm: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-full -mr-16 -mt-16 blur-2xl" />
        
        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mb-6 transform -rotate-6">
            <LogOut className="w-10 h-10 text-red-500" />
          </div>
          
          <h3 className="text-2xl font-serif font-bold text-brand-primary mb-3">تسجيل الخروج</h3>
          <p className="text-brand-secondary opacity-70 mb-8 leading-relaxed">
            هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟
          </p>
          
          <div className="flex flex-col w-full gap-3">
            <button 
              onClick={onConfirm}
              className="w-full py-4 bg-red-500 text-white font-bold rounded-2xl hover:bg-red-600 transition-all active:scale-95 shadow-lg shadow-red-500/20"
            >
              تسجيل الخروج
            </button>
            <button 
              onClick={onClose}
              className="w-full py-4 bg-brand-muted text-brand-secondary font-bold rounded-2xl hover:bg-brand-muted/80 transition-all"
            >
              إلغاء
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function AdDetailsView({ ad, onBack, onStartChat, currentUser, profile, blockedUsers, createNotification, isFavorited, onToggleFavorite, onViewProfile }: any) {
  const [sellerProfile, setSellerProfile] = useState<any>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMarkingSold, setIsMarkingSold] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  const isBlocked = blockedUsers?.includes(ad.sellerId);

  useEffect(() => {
    const fetchSeller = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', ad.sellerId));
        if (snap.exists()) {
          setSellerProfile(snap.data());
        }
      } catch (e) { console.error("Error fetching seller:", e); }
    };
    fetchSeller();
  }, [ad.sellerId]);

  const toggleBlockUser = async () => {
    if (!currentUser || ad.sellerId === currentUser.uid) return;
    
    setIsBlocking(true);
    try {
      const blockRef = doc(db, 'users', currentUser.uid, 'blocks', ad.sellerId);
      if (isBlocked) {
        await deleteDoc(blockRef);
      } else {
        await setDoc(blockRef, {
          blockedUserId: ad.sellerId,
          createdAt: serverTimestamp()
        });
        onBack();
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${currentUser.uid}/blocks/${ad.sellerId}`);
    } finally {
      setIsBlocking(false);
    }
  };

  // Fallback for single image or empty images array
  const images = ad.images && ad.images.length > 0 ? ad.images : ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=2000&auto=format&fit=crop'];


  const handleMarkAsSold = async () => {
    if (!currentUser || ad.sellerId !== currentUser.uid) return;
    setIsMarkingSold(true);
    try {
      await updateDoc(doc(db, 'ads', ad.id), { status: 'sold' });
      
      // Notify potential buyers (those who chatted about this ad)
      const chatsQuery = query(collection(db, 'chats'), where('adId', '==', ad.id));
      const chatSnap = await getDocs(chatsQuery);
        chatSnap.forEach(async (chatDoc) => {
          const chatData = chatDoc.data();
          const recipientId = chatData.participants.find((p: string) => p !== currentUser?.uid);
          if (recipientId) {
            await createNotification(
                recipientId,
                'تم بيع المنتج!',
                `لقد تم بيع "${ad.title}" الذي كنت مهتماً به.`,
                'sale',
                { adId: ad.id }
            );
          }
        });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `ads/${ad.id}`);
    } finally {
      setIsMarkingSold(false);
    }
  };

  const nextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-brand-bg min-h-screen pb-24 lg:pb-32"
    >
      {/* Sticky Top Header */}
      <div className="sticky top-0 z-[60] bg-brand-bg/80 backdrop-blur-xl border-b border-brand-border/40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2.5 bg-white border border-brand-border rounded-2xl text-brand-primary shadow-sm hover:shadow-md active:scale-95 transition-all">
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-sm font-serif font-bold text-brand-primary line-clamp-1 max-w-[150px] md:max-w-[300px]">{ad.title}</h1>
            <p className="text-[10px] text-brand-secondary font-medium opacity-60">تفاصيل المنتج</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={onToggleFavorite}
            className="p-2.5 bg-white border border-brand-border rounded-2xl text-brand-primary shadow-sm hover:shadow-md transition-all active:scale-90"
          >
            <Heart className={cn("w-5 h-5", isFavorited && "fill-red-500 text-red-500")} />
          </button>
          <button 
            onClick={() => setIsShareModalOpen(true)}
            className="p-2.5 bg-white border border-brand-border rounded-2xl text-brand-primary shadow-sm hover:shadow-md transition-all active:scale-90"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-12">
        {/* Photo Header */}
        <div className="relative aspect-[4/3] bg-brand-muted overflow-hidden rounded-[40px] shadow-2xl shadow-brand-primary/5">
        <AnimatePresence mode="wait">
          <motion.img 
            key={currentImageIndex}
            src={images[currentImageIndex]} 
            alt={`${ad.title} ${currentImageIndex + 1}`} 
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-full h-full object-cover cursor-zoom-in"
            onClick={() => setIsFullscreen(true)}
          />
        </AnimatePresence>

        {/* Carousel Indicators */}
        {images.length > 1 && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-1.5 z-20">
            {images.map((_: any, idx: number) => (
              <div 
                key={`img-dot-${idx}`}
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-all",
                  idx === currentImageIndex ? "bg-white w-4 scale-110" : "bg-white/40"
                )}
              />
            ))}
          </div>
        )}

        {/* Carousel Controls */}
        {images.length > 1 && (
          <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-4 pointer-events-none">
            <button 
              onClick={prevImage}
              className="p-3 bg-black/20 backdrop-blur-md rounded-full text-white pointer-events-auto hover:bg-black/40 transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            <button 
              onClick={nextImage}
              className="p-3 bg-black/20 backdrop-blur-md rounded-full text-white pointer-events-auto hover:bg-black/40 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          </div>
        )}
      </div>

      {/* Image Zoom Modal */}
      <AnimatePresence>
        {isShareModalOpen && (
          <ShareModal 
            isOpen={isShareModalOpen} 
            onClose={() => setIsShareModalOpen(false)} 
            ad={ad} 
          />
        )}
        {isFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center"
            onClick={() => setIsFullscreen(false)}
          >
            <button 
              className="absolute top-6 right-6 p-3 bg-white/10 rounded-full text-white z-[110]"
              onClick={(e) => { e.stopPropagation(); setIsFullscreen(false); }}
            >
              <X className="w-6 h-6" />
            </button>
            
            <motion.div 
              className="w-full h-full flex items-center justify-center p-4"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={images[currentImageIndex]} 
                alt={ad.title}
                className="max-w-full max-h-full object-contain"
              />
            </motion.div>

            {images.length > 1 && (
              <div className="absolute bottom-10 left-0 right-0 flex justify-center items-center gap-8 text-white px-10">
                <button 
                  onClick={prevImage}
                  className="p-4 bg-white/10 rounded-full hover:bg-white/20 transition-all active:scale-90"
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
                <span className="text-lg font-bold font-mono">
                  {currentImageIndex + 1} / {images.length}
                </span>
                <button 
                  onClick={nextImage}
                  className="p-4 bg-white/10 rounded-full hover:bg-white/20 transition-all active:scale-90"
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-0 space-y-16">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
             <span className="bg-black text-white text-[9px] font-black px-3 py-1 rounded-sm uppercase tracking-widest">{CATEGORIES.find(c => c.id === ad.category)?.label}</span>
             <span className="border border-brand-border text-[9px] font-black px-3 py-1 rounded-sm uppercase tracking-widest">{CONDITIONS.find(c => c.id === ad.condition)?.label}</span>
          </div>
          <h2 className="text-4xl font-black text-black leading-tight lg:text-5xl tracking-tighter">{ad.title}</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-black text-black">{ad.price.toLocaleString()}</span>
            <span className="text-xs font-bold opacity-30 uppercase tracking-widest">د.ع</span>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-12 border-y border-brand-border py-12">
          <div className="space-y-1">
             <p className="text-[9px] font-black uppercase tracking-widest opacity-30">الموقع</p>
             <p className="text-sm font-bold">{ad.location.city}</p>
          </div>
          <div className="space-y-1">
             <p className="text-[9px] font-black uppercase tracking-widest opacity-30">المعلن</p>
             <p className="text-sm font-bold">{ad.sellerName}</p>
          </div>
          <div className="space-y-1">
             <p className="text-[9px] font-black uppercase tracking-widest opacity-30">الحالة</p>
             <p className="text-sm font-bold">نشط</p>
          </div>
        </div>


        <div className="space-y-4">
          <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40">الوصف</h3>
          <div className="text-sm leading-relaxed text-brand-secondary max-w-2xl whitespace-pre-wrap">
            {ad.description || "لا يوجد وصف مطول."}
          </div>
        </div>

        {/* Seller Card */}
        <div className="bg-white border border-brand-border rounded-[40px] p-8 shadow-sm lg:p-12">
          <div className="flex flex-col md:flex-row items-center gap-8 justify-between">
            <div className="flex flex-col md:flex-row items-center gap-6 text-center md:text-right">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-tr from-brand-primary to-brand-muted rounded-[30px] opacity-20 blur group-hover:opacity-40 transition duration-500"></div>
                <div className="relative w-20 h-20 bg-brand-muted border border-brand-border rounded-[28px] overflow-hidden lg:w-24 lg:h-24">
                  {sellerProfile?.photoURL ? (
                    <img src={sellerProfile.photoURL} alt={ad.sellerName} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  ) : (
                    <img src={`https://ui-avatars.com/api/?name=${ad.sellerName}&background=51513d&color=fff`} alt={ad.sellerName} className="w-full h-full" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex flex-col">
                  <p className="font-serif font-bold text-2xl text-brand-primary tracking-tight">{ad.sellerName}</p>
                  <p className="text-[11px] font-bold text-brand-secondary uppercase tracking-[2px] opacity-40 mt-1">البائع الموثوق</p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 w-full md:w-auto">
              <button 
                onClick={() => onViewProfile(ad.sellerId)}
                className="flex-1 md:flex-none text-brand-primary text-sm font-bold bg-brand-muted px-8 py-4 rounded-[20px] border border-brand-border hover:bg-brand-primary hover:text-white hover:shadow-lg transition-all active:scale-95 duration-300"
              >
                الملف الشخصي
              </button>
              {currentUser && ad.sellerId !== currentUser.uid && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowBlockConfirm(true); }}
                  disabled={isBlocking}
                  className={cn(
                    "p-4 rounded-[20px] border transition-all flex items-center justify-center active:scale-90",
                    isBlocked 
                      ? "bg-red-50 border-red-100 text-red-500 hover:bg-red-100" 
                      : "bg-gray-50 border-brand-border text-brand-secondary hover:bg-red-50 hover:text-red-500 hover:border-red-100 shadow-sm"
                  )}
                  title={isBlocked ? "إلغاء الحظر" : "حظر المستخدم"}
                >
                  {isBlocking ? <Loader2 className="w-5 h-5 animate-spin" /> : <Ban className="w-5 h-5" />}
                </button>
              )}
            </div>
          </div>

          <ConfirmModal 
            isOpen={showBlockConfirm}
            onClose={() => setShowBlockConfirm(false)}
            onConfirm={toggleBlockUser}
            title={isBlocked ? "إلغاء الحظر" : "حظر المستخدم"}
            message={isBlocked ? "هل تريد إلغاء حظر هذا المستخدم؟" : "هل أنت متأكد أنك تريد حظر هذا المستخدم؟ لن تظهر إعلاناته لك ولن تتمكن من مراسلته."}
            confirmText={isBlocked ? "إلغاء الحظر" : "حظر المستخدم"}
            isDestructive={!isBlocked}
          />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4 pb-12">
          {ad.status === 'active' ? (
            currentUser?.uid !== ad.sellerId ? (
              <>
                <button 
                  onClick={onStartChat}
                  className="flex items-center justify-center gap-3 bg-brand-primary text-white py-5 rounded-[24px] font-bold shadow-xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                >
                  <MessageSquare className="w-5 h-5" />
                  <span className="text-lg">دردشة</span>
                </button>
                <a 
                  href={`https://wa.me/${ad.whatsappNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-3 bg-white border-2 border-brand-primary text-brand-primary py-5 rounded-[24px] font-bold hover:bg-brand-muted active:scale-95 transition-all"
                >
                  <Phone className="w-5 h-5" />
                  <span className="text-lg">واتساب</span>
                </a>
              </>
            ) : (
              <div className="col-span-2 p-8 bg-brand-muted rounded-[32px] border border-brand-border text-center">
                <p className="text-brand-secondary font-medium italic opacity-60">أنت صاحب هذا الإعلان</p>
              </div>
            )
          ) : (
            <div className="col-span-2 text-center py-8 text-brand-secondary font-bold bg-brand-muted rounded-3xl border border-brand-border lg:text-xl">
              هذا الإعلان غير نشط حالياً
            </div>
          )}
        </div>

        {/* Removed redundant owner actions */}

        {/* Comments Section */}
        <div className="space-y-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-secondary">التعليقات</h3>
          <CommentSection 
            adId={ad.id} 
            sellerId={ad.sellerId} 
            adTitle={ad.title} 
            currentUser={currentUser} 
            profile={profile}
            createNotification={createNotification}
          />
        </div>
      </div>
    </div>
    </motion.div>
  );
}


function CommentSection({ adId, sellerId, adTitle, currentUser, profile, createNotification }: any) {
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'ads', adId, 'comments'), orderBy('createdAt', 'desc'), limit(10));
    return onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `ads/${adId}/comments`);
    });
  }, [adId]);

  const postComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !currentUser || submitting) return;
    setSubmitting(true);
    try {
      const text = newComment;
      setNewComment('');
      await addDoc(collection(db, 'ads', adId, 'comments'), {
        userId: currentUser.uid,
        userName: currentUser.displayName || 'مستخدم',
        userPhoto: profile?.photoURL || currentUser.photoURL || '',
        text,
        createdAt: serverTimestamp()
      });

      // Notify Seller
      if (currentUser.uid !== sellerId) {
        await createNotification(
          sellerId,
          'تعليق جديد على إعلانك',
          `${currentUser.displayName} علّق على "${adTitle}": ${text}`,
          'comment',
          { adId }
        );
      }
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      {currentUser && (
        <form onSubmit={postComment} className="flex gap-2">
          <input 
            type="text" 
            placeholder="أضف تعليقاً..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="flex-1 bg-white border border-brand-border rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand-primary/20"
          />
          <button 
            type="submit"
            disabled={!newComment.trim() || submitting}
            className="p-3 bg-brand-primary text-white rounded-2xl disabled:opacity-50"
          >
            <Plus className="w-5 h-5" />
          </button>
        </form>
      )}
      <div className="space-y-3">
        {comments.map(c => (
          <div key={`cmt-${c.id}`} className="bg-white p-4 rounded-2xl border border-brand-border text-sm flex gap-3">
            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-brand-border bg-brand-muted">
              {c.userPhoto ? (
                <img src={c.userPhoto} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className="w-4 h-4 text-brand-secondary opacity-40" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-[#444432]">{c.userName}</span>
                <span className="text-[10px] text-brand-secondary">
                  {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : '...'}
                </span>
              </div>
              <p className="text-[#6b6b5d]">{c.text}</p>
            </div>
          </div>
        ))}
        {comments.length === 0 && <p className="text-center text-xs text-brand-secondary opacity-50 py-4">لا توجد تعليقات بعد</p>}
      </div>
    </div>
  );
}

function SellerProfileView({ userId, onBack, onAdClick, onStartChat, currentUser }: any) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const userSnap = await getDoc(doc(db, 'users', userId));
        if (userSnap.exists()) {
          setProfile(userSnap.data() as UserProfile);
        }

        const adsQuery = query(
          collection(db, 'ads'),
          where('sellerId', '==', userId),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc')
        );
        const adsSnap = await getDocs(adsQuery);
        setAds(adsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Ad)));

      } catch (e) {
        console.error("Error fetching seller profile:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-brand-bg min-h-screen pb-24"
    >
      <div className="bg-white border-b border-brand-border p-4 sticky top-0 z-30 flex items-center gap-4">
        <button onClick={onBack} className="p-3 bg-brand-muted rounded-2xl text-brand-primary">
          <ChevronRight className="w-6 h-6" />
        </button>
        <h2 className="text-xl font-serif font-bold text-brand-primary">
          ملف البائع
        </h2>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-tr from-brand-primary to-brand-muted rounded-full opacity-20 blur group-hover:opacity-40 transition duration-500"></div>
            <div className="relative w-32 h-32 bg-brand-muted border-4 border-white rounded-full overflow-hidden shadow-2xl">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt={profile.displayName} className="w-full h-full object-cover" />
              ) : (
                <img src={`https://ui-avatars.com/api/?name=${profile?.displayName}&background=51513d&color=fff`} className="w-full h-full" alt="" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-serif font-bold text-brand-primary">{profile?.displayName}</h1>
            <div className="flex items-center justify-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-brand-primary opacity-40">البائع الموثوق</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 w-full max-w-xs">
            <div className="bg-white p-6 rounded-3xl border border-brand-border shadow-sm text-center">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-30 mb-1">الإعلانات النشطة</p>
              <p className="text-xl font-serif font-bold text-brand-primary">{ads.length}</p>
            </div>
          </div>
        </div>

        <div className="space-y-12">
          <div className="space-y-8">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] border-b border-brand-border pb-4">إعلانات البائع</h3>
          {ads.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {ads.map(ad => (
                <AdCard 
                  key={`seller-ad-${ad.id}`} 
                  ad={ad} 
                  onClick={() => onAdClick(ad)}
                  hideFavorite={true}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 opacity-30">
              <ShoppingBag className="w-8 h-8 mx-auto mb-4" />
              <p className="text-sm font-bold uppercase tracking-widest">لا توجد إعلانات نشطة</p>
            </div>
          )}
        </div>
      </div>
    </div>
    </motion.div>
  );
}

function ProfileView({ user, profile, onLogout, onBack, onViewMyAds, onViewNotifications, unreadNotifications, onViewBlocked, blockedUsers, onViewFavorites }: any) {
  const [editing, setEditing] = useState(false);
  const [myAdsCount, setMyAdsCount] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    displayName: profile?.displayName || '',
    photoURL: profile?.photoURL || user.photoURL || '',
    whatsappNumber: profile?.whatsappNumber || '',
    phoneNumber: profile?.phoneNumber || '',
    address: profile?.address || '',
    birthDate: profile?.birthDate || ''
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        displayName: profile.displayName || '',
        photoURL: profile.photoURL || user.photoURL || '',
        whatsappNumber: profile.whatsappNumber || '',
        phoneNumber: profile.phoneNumber || '',
        address: profile.address || '',
        birthDate: profile.birthDate || ''
      });
    }
  }, [profile, user.photoURL]);

  useEffect(() => {
    const q = query(collection(db, 'ads'), where('sellerId', '==', user.uid));
    getDocs(q).then(snap => setMyAdsCount(snap.size));
  }, [user.uid]);

  const handleSave = async () => {
    if (!formData.displayName.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), formData);
      setEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSendVerification = async () => {
    if (!user) return;
    setVerifying(true);
    try {
      await sendEmailVerification(user);
      setLinkSent(true);
      setTimeout(() => setLinkSent(false), 5000);
    } catch (error) {
      console.error('Error sending verification email:', error);
    } finally {
      setVerifying(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const compressed = await compressImage(reader.result as string, 400, 400, 0.6);
      setFormData({ ...formData, photoURL: compressed });
    };
    reader.readAsDataURL(file);
  };

  if (editing) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="p-6 bg-brand-bg min-h-screen"
      >
        <div className="flex items-center justify-between mb-8">
          <button onClick={() => setEditing(false)} className="p-3 bg-white border border-brand-border rounded-xl">
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-serif font-bold text-brand-primary">تعديل الملف</h2>
          <button 
            disabled={saving}
            onClick={handleSave} 
            className="p-3 bg-brand-primary text-white rounded-xl shadow-lg shadow-brand-primary/20"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex flex-col items-center mb-8">
            <div className="relative group">
              <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-brand-primary/10 shadow-xl bg-brand-muted">
                {formData.photoURL ? (
                  <img src={formData.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User className="w-10 h-10 text-brand-secondary opacity-20" />
                  </div>
                )}
              </div>
              <label 
                htmlFor="photo-upload" 
                className="absolute bottom-0 right-0 w-10 h-10 bg-brand-primary text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:scale-110 active:scale-95 transition-all border-4 border-white"
              >
                <Camera className="w-5 h-5" />
                <input 
                  id="photo-upload" 
                  type="file" 
                  accept="image/*" 
                  onChange={handlePhotoChange} 
                  className="hidden" 
                />
              </label>
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-primary opacity-40 mt-4">تغيير الصورة الشخصية</p>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-brand-border space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-brand-primary opacity-40 block mb-2">الاسم الكامل</label>
              <input 
                type="text"
                value={formData.displayName}
                onChange={e => setFormData({...formData, displayName: e.target.value})}
                className="w-full bg-brand-bg border-none rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand-primary/10"
                placeholder="أدخل اسمك..."
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-brand-primary opacity-40 block mb-2">رقم الهاتف</label>
              <div className="flex bg-brand-bg rounded-2xl px-4 items-center">
                <Phone className="w-4 h-4 text-brand-secondary opacity-40" />
                <input 
                  type="tel"
                  value={formData.phoneNumber}
                  onChange={e => setFormData({...formData, phoneNumber: e.target.value})}
                  className="flex-1 bg-transparent border-none px-3 py-3 outline-none"
                  placeholder="07xxxxxxxx"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-brand-primary opacity-40 block mb-2">رقم الواتساب</label>
              <div className="flex bg-brand-bg rounded-2xl px-4 items-center">
                <MessageSquare className="w-4 h-4 text-brand-secondary opacity-40" />
                <input 
                  type="tel"
                  value={formData.whatsappNumber}
                  onChange={e => setFormData({...formData, whatsappNumber: e.target.value})}
                  className="flex-1 bg-transparent border-none px-3 py-3 outline-none"
                  placeholder="07xxxxxxxx"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-brand-primary opacity-40 block mb-2">العنوان</label>
              <div className="flex bg-brand-bg rounded-2xl px-4 items-center">
                <MapPin className="w-4 h-4 text-brand-secondary opacity-40" />
                <input 
                  type="text"
                  value={formData.address}
                  onChange={e => setFormData({...formData, address: e.target.value})}
                  className="flex-1 bg-transparent border-none px-3 py-3 outline-none"
                  placeholder="المدينة، الحي..."
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-brand-primary opacity-40 block mb-2">تاريخ الميلاد</label>
              <div className="flex bg-brand-bg rounded-2xl px-4 items-center">
                <Calendar className="w-4 h-4 text-brand-secondary opacity-40" />
                <input 
                  type="date"
                  value={formData.birthDate}
                  onChange={e => setFormData({...formData, birthDate: e.target.value})}
                  className="flex-1 bg-transparent border-none px-3 py-3 outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="p-6 bg-brand-bg min-h-screen"
    >
      <div className="flex items-center justify-between mb-10">
        <button onClick={onBack} className="p-3 bg-white border border-brand-border rounded-xl shadow-sm text-brand-primary active:scale-95 transition-all">
          <ChevronRight className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-serif font-bold text-brand-primary">الملف الشخصي</h2>
        <button onClick={() => setEditing(true)} className="p-3 bg-white border border-brand-border rounded-xl shadow-sm text-brand-primary active:scale-95 transition-all">
          <Settings className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col items-center text-center mb-10">
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-xl bg-gray-100">
            {profile?.photoURL || user.photoURL ? (
              <img src={profile?.photoURL || user.photoURL} alt={user.displayName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-8 h-8 text-gray-400" />
              </div>
            )}
          </div>
          {user.emailVerified ? (
            <div className="absolute bottom-1 right-1 w-7 h-7 bg-green-500 rounded-full border-2 border-white flex items-center justify-center text-white shadow-lg">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          ) : (
            <div className="absolute bottom-1 right-1 w-7 h-7 bg-amber-500 rounded-full border-2 border-white flex items-center justify-center text-white shadow-lg">
              <AlertCircle className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-2xl font-serif font-bold text-brand-primary">{profile?.displayName || user.displayName}</h3>
          {user.emailVerified && (
            <span className="text-[9px] bg-brand-primary/5 text-brand-primary px-2 py-0.5 rounded-full font-black uppercase tracking-wider">البائع الموثوق</span>
          )}
        </div>
        <p className="text-brand-secondary text-xs opacity-60 mb-6">{user.email}</p>

        {(profile?.phoneNumber || profile?.address) && (
          <div className="flex flex-col gap-2 mb-6 text-brand-secondary text-xs opacity-80">
            {profile.phoneNumber && <span className="flex items-center gap-1 justify-center"><Phone className="w-3 h-3" /> {profile.phoneNumber}</span>}
            {profile.address && <span className="flex items-center gap-1 justify-center"><MapPin className="w-3 h-3" /> {profile.address}</span>}
          </div>
        )}

        <div className="flex gap-4 w-full px-4 justify-center">
          <div className="bg-white p-5 rounded-3xl border border-brand-border shadow-sm w-full max-w-xs">
            <p className="text-[9px] font-black uppercase tracking-widest text-brand-primary opacity-40 mb-1">إعلاناتك</p>
            <p className="font-serif font-bold text-xl text-brand-primary">{myAdsCount}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4">
        <MenuButton 
          onClick={onViewNotifications} 
          icon={<Bell className={cn(unreadNotifications > 0 && "text-red-500 fill-red-500")} />} 
          label="التنبيهات" 
          badge={unreadNotifications > 0 ? unreadNotifications : undefined}
        />
        <MenuButton onClick={onViewMyAds} icon={<ShoppingBag />} label="إعلاناتي" />
        <MenuButton onClick={onViewFavorites} icon={<Heart />} label="المفضلة" />
        <MenuButton icon={<MapPin />} label="عناوين الشحن" />
        <MenuButton 
          onClick={onViewBlocked}
          icon={<Ban className="text-brand-secondary" />} 
          label="المستخدمين المحظورين" 
          badge={blockedUsers?.length > 0 ? blockedUsers.length : undefined}
        />
      </div>

      <button 
        onClick={onLogout}
        className="mx-auto block text-red-400 text-xs font-bold mt-12 mb-8 hover:text-red-600 transition-colors"
      >
        تسجيل الخروج من الحساب
      </button>
    </motion.div>
  );
}

function MyAdsView({ user, onBack, onAdClick }: any) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);

  const [showConfirm, setShowConfirm] = useState(false);
  const [adToDelete, setAdToDelete] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'ads'), 
      where('sellerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    
    return onSnapshot(q, (snap) => {
      setAds(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ad)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'ads');
    });
  }, [user.uid]);

  const handleDeleteClick = (adId: string) => {
    setAdToDelete(adId);
    setShowConfirm(true);
  };

  const confirmDelete = async () => {
    if (!adToDelete) return;
    try {
      // First, delete comments subcollection (client-side cleanup)
      const commentsRef = collection(db, 'ads', adToDelete, 'comments');
      const commentsSnap = await getDocs(commentsRef);
      const batchDeletePromises = commentsSnap.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(batchDeletePromises);

      // Finally, delete the ad document
      await deleteDoc(doc(db, 'ads', adToDelete));
    } catch (e) { 
      handleFirestoreError(e, OperationType.DELETE, `ads/${adToDelete}`);
    } finally {
      setShowConfirm(false);
      setAdToDelete(null);
    }
  };

  const markSold = async (adId: string) => {
    try {
      await updateDoc(doc(db, 'ads', adId), { status: 'sold' });
    } catch (e) { console.error(e); }
  };

  const repostAd = async (adId: string) => {
    try {
      await updateDoc(doc(db, 'ads', adId), { 
        createdAt: serverTimestamp(),
        status: 'active' 
      });
    } catch (e) { 
      handleFirestoreError(e, OperationType.UPDATE, `ads/${adId}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-6 bg-brand-bg min-h-screen"
    >
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-3 bg-white border border-brand-border rounded-2xl text-brand-primary">
          <ChevronRight className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-serif font-bold text-[#444432]">إعلاناتي</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-primary" /></div>
      ) : ads.length > 0 ? (
        <div className="space-y-6">
          {ads.map(ad => (
            <div key={`myad-${ad.id}`} className="bg-white p-4 rounded-[32px] border border-brand-border shadow-sm flex gap-4 overflow-hidden group">
              <div 
                className="w-24 h-24 rounded-2xl overflow-hidden shrink-0 bg-brand-muted cursor-pointer"
                onClick={() => onAdClick(ad)}
              >
                <img src={ad.images[0]} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0 py-1">
                <h3 className="font-bold text-[#444432] truncate">{ad.title}</h3>
                <p className="text-brand-primary font-bold">{ad.price.toLocaleString()} د.ع</p>
                
                <div className="flex items-center gap-2 mt-2">
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full font-bold",
                    ad.status === 'active' ? "bg-green-50 text-green-600" : 
                    ad.status === 'sold' ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"
                  )}>
                    {ad.status === 'active' ? 'نشط' : ad.status === 'sold' ? 'تم البيع' : 'محذوف'}
                  </span>
                  <span className="text-[10px] text-brand-secondary opacity-60">
                    {ad.createdAt?.toDate ? ad.createdAt.toDate().toLocaleDateString() : '...'}
                  </span>
                </div>
              </div>
              
              <div className="flex flex-col gap-2 justify-center">
                {ad.status === 'active' && (
                  <>
                    <button 
                      onClick={() => repostAd(ad.id)}
                      className="p-2 bg-brand-primary/10 text-brand-primary rounded-xl hover:bg-brand-primary/20 transition-all active:scale-95"
                      title="تجديد الإعلان"
                    >
                      <Sparkles className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => markSold(ad.id)}
                      className="p-2 bg-green-50 text-green-600 rounded-xl hover:bg-green-100 transition-all active:scale-95"
                      title="تحديد كمباع"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                  </>
                )}
                {ad.status !== 'deleted' && (
                  <button 
                    onClick={() => handleDeleteClick(ad.id)}
                    className="p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors transition-all active:scale-95"
                    title="حذف الإعلان"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          ))}

          <ConfirmDialog 
            isOpen={showConfirm}
            title="حذف الإعلان"
            message="هل أنت متأكد أنك تريد حذف هذا الإعلان؟ لا يمكن التراجع عن هذا الإجراء."
            onConfirm={confirmDelete}
            onCancel={() => {
              setShowConfirm(false);
              setAdToDelete(null);
            }}
          />
        </div>
      ) : (
        <div className="text-center py-20 opacity-50">
          <ShoppingBag className="w-12 h-12 mx-auto mb-4" />
          <p>ليس لديك إعلانات منشورة</p>
        </div>
      )}
    </motion.div>
  );
}

function FavoritesView({ favorites, onBack, onAdClick, onToggleFavorite }: any) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (favorites.length === 0) {
      setAds([]);
      setLoading(false);
      return;
    }

    const fetchFavorites = async () => {
      setLoading(true);
      try {
        const fetchedAds: Ad[] = [];
        const uniqueIds = Array.from(new Set<string>(favorites.slice(0, 50)));
        for (const adId of uniqueIds) {
          const snap = await getDoc(doc(db, 'ads', adId));
          if (snap.exists()) {
            fetchedAds.push({ id: snap.id, ...snap.data() } as Ad);
          }
        }
        setAds(fetchedAds);
      } catch (e) {
        console.error("Error fetching favorites:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchFavorites();
  }, [favorites]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-6 bg-brand-bg min-h-screen"
    >
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-3 bg-white border border-brand-border rounded-2xl text-brand-primary">
          <ChevronRight className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-serif font-bold text-[#444432]">المفضلة</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-primary" /></div>
      ) : ads.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-12">
          {ads.map(ad => (
            <AdCard 
              key={`fav-ad-${ad.id}`} 
              ad={ad} 
              onClick={() => onAdClick(ad)} 
              isFavorited={true}
              onToggleFavorite={() => onToggleFavorite(ad.id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 opacity-50">
          <Heart className="w-12 h-12 mx-auto mb-4" />
          <p>لا توجد إعلانات في المفضلة</p>
        </div>
      )}
    </motion.div>
  );
}

// --- Atomic Components ---

function AdCard({ ad, onClick, isFavorited, onToggleFavorite, hideFavorite }: { 
  ad: Ad, 
  onClick: () => void, 
  isFavorited?: boolean, 
  onToggleFavorite?: (e: React.MouseEvent) => void,
  hideFavorite?: boolean
}) {
  return (
    <motion.div 
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group cursor-pointer space-y-4"
    >
      <div className="relative aspect-[4/5] bg-brand-muted overflow-hidden rounded-[40px] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-500">
        <img src={ad.images[0]} alt={ad.title} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
        {ad.status === 'sold' && (
          <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] flex items-center justify-center">
            <span className="text-xs font-black uppercase tracking-[0.2em] text-black">مباع</span>
          </div>
        )}
        {!hideFavorite && (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.(e);
            }}
            className="absolute top-4 left-4 p-3 rounded-2xl bg-white/80 backdrop-blur-md shadow-sm transition-all hover:scale-110 active:scale-95"
          >
            <Heart className={cn("w-4 h-4 transition-colors", isFavorited ? "fill-red-500 text-red-500" : "text-brand-secondary")} />
          </button>
        )}
      </div>
      <div className="space-y-1 px-4 pb-2">
        <div className="flex justify-between items-start">
          <h3 className="font-serif font-bold text-sm leading-tight line-clamp-1 text-brand-primary flex-1">{ad.title}</h3>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-black text-brand-primary">
            {ad.price.toLocaleString()} <span className="text-[10px] font-bold opacity-30">د.ع</span>
          </p>
          <div className="flex items-center gap-1 text-[9px] font-bold text-brand-secondary opacity-40 uppercase tracking-widest">
             <span>{ad.location.city}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function NavButton({ icon, label, active, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 transition-all relative px-2",
        active ? "text-brand-primary" : "text-brand-secondary opacity-60 hover:opacity-100"
      )}
    >
      <div className={cn(
        "transition-transform duration-300",
        active ? "scale-110" : "scale-100"
      )}>
        {React.cloneElement(icon, { className: cn("w-5.5 h-5.5", active && "stroke-[2.5px]") })}
      </div>
      <span className="text-[9px] font-black uppercase tracking-tighter">{label}</span>
      {active && (
        <motion.div 
          layoutId="nav-pill" 
          className="absolute -top-1 w-1 h-1 bg-brand-primary rounded-full shadow-[0_0_8px_rgba(81,81,61,0.5)]" 
        />
      )}
    </button>
  );
}

function NotificationsView({ onBack }: { onBack: () => void }) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'), 
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
      
      // Mark as read
      snapshot.docs.forEach(d => {
        if (!d.data().read) {
          updateDoc(doc(db, 'notifications', d.id), { read: true });
        }
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'notifications');
    });

    return () => unsubscribe();
  }, [user]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="p-6 bg-brand-bg min-h-screen"
    >
      <div className="flex items-center justify-between mb-10">
        <button onClick={onBack} className="p-3 bg-white border border-brand-border rounded-xl shadow-sm text-brand-primary">
          <ChevronRight className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-black text-black">التنبيهات</h2>
        <div className="w-11"></div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : notifications.length > 0 ? (
        <div className="space-y-4">
          {notifications.map(n => (
            <div key={`notif-${n.id}`} className={cn(
              "p-4 rounded-xl border border-brand-border bg-white transition-all",
              !n.read && "border-black shadow-sm"
            )}>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-brand-muted rounded-lg flex items-center justify-center shrink-0">
                  {n.type === 'sale' ? <ShoppingBag className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
                </div>
                <div>
                  <h4 className="font-bold text-sm mb-1">{n.title}</h4>
                  <p className="text-xs text-brand-secondary leading-relaxed">{n.message}</p>
                  <p className="text-[9px] opacity-40 mt-2 font-black uppercase tracking-widest">
                    {n.createdAt?.toDate()?.toLocaleDateString('ar-IQ')}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-40 opacity-30">
          <Bell className="w-8 h-8 mx-auto mb-4" />
          <p className="text-xs font-black uppercase tracking-widest">لا توجد تنبيهات جديدة</p>
        </div>
      )}
    </motion.div>
  );
}

function MenuButton({ icon, label, onClick, badge }: any) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between p-4 bg-white border border-brand-border rounded-2xl hover:bg-brand-muted transition-all active:scale-[0.98]">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-brand-muted rounded-xl flex items-center justify-center text-brand-primary relative">
          {icon && React.isValidElement(icon) ? React.cloneElement(icon as any, { className: "w-5 h-5" }) : icon}
          {badge && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full font-bold border-2 border-white">
              {badge}
            </span>
          )}
        </div>
        <span className="font-bold text-sm text-brand-primary">{label}</span>
      </div>
      <ChevronLeft className="w-4 h-4 text-brand-secondary opacity-40" />
    </button>
  );
}

function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel }: { isOpen: boolean, title: string, message: string, onConfirm: () => void, onCancel: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-[32px] p-8 max-w-sm w-full shadow-2xl space-y-6"
      >
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        
        <div className="text-center space-y-2">
          <h3 className="text-xl font-bold text-[#444432]">{title}</h3>
          <p className="text-sm text-brand-secondary leading-relaxed">{message}</p>
        </div>

        <div className="flex flex-col gap-3">
          <button 
            onClick={onConfirm}
            className="w-full py-4 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 active:scale-[0.98]"
          >
            تأكيد الحذف
          </button>
          <button 
            onClick={onCancel}
            className="w-full py-4 bg-brand-bg text-[#444432] rounded-2xl font-bold hover:bg-brand-muted transition-colors active:scale-[0.98]"
          >
            إلغاء
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function BlockedUsersView({ user, blockedUsers, onBack }: any) {
  const [blockedProfiles, setBlockedProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userToUnblock, setUserToUnblock] = useState<any | null>(null);

  useEffect(() => {
    const fetchProfiles = async () => {
      setLoading(true);
      try {
        const profiles = await Promise.all(blockedUsers.map(async (uid: string) => {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            return { id: uid, ...snap.data() };
          }
          return { id: uid, displayName: 'مستخدم محظور' };
        }));
        setBlockedProfiles(profiles);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    if (blockedUsers?.length > 0) {
      fetchProfiles();
    } else {
      setBlockedProfiles([]);
      setLoading(false);
    }
  }, [blockedUsers]);

  const unblockUser = async () => {
    if (!user || !userToUnblock) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'blocks', userToUnblock.id));
      setUserToUnblock(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/blocks/${userToUnblock.id}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-6 bg-brand-bg min-h-screen"
    >
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 hover:bg-brand-muted rounded-full">
          <ChevronRight className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-serif font-bold text-[#444432]">المستخدمين المحظورين</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>
      ) : blockedProfiles.length === 0 ? (
        <div className="text-center py-20 opacity-50 bg-white rounded-3xl border border-brand-border">
          <Ban className="w-12 h-12 mx-auto mb-4" />
          <p>قائمة الحظر فارغة</p>
        </div>
      ) : (
        <div className="space-y-4">
          {blockedProfiles.map((p: any) => (
            <div key={`blocked-${p.id}`} className="flex items-center justify-between bg-white p-4 rounded-2xl border border-brand-border">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-brand-muted shrink-0">
                  <img src={p.photoURL || `https://ui-avatars.com/api/?name=${p.displayName}&background=5A5A40&color=fff`} alt="" />
                </div>
                <span className="font-bold">{p.displayName}</span>
              </div>
              <button 
                onClick={() => setUserToUnblock(p)}
                className="text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-xl hover:bg-red-100 transition-colors"
              >
                إلغاء الحظر
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal 
        isOpen={!!userToUnblock}
        onClose={() => setUserToUnblock(null)}
        onConfirm={unblockUser}
        title="إلغاء الحظر"
        message={`هل تريد إلغاء حظر "${userToUnblock?.displayName}"؟`}
        confirmText="إلغاء الحظر"
      />
    </motion.div>
  );
}


