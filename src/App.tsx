/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Plus, User, Home, MessageSquare, MapPin, 
  Filter, Heart, Share2, Phone, Star, Camera, 
  CheckCircle2, AlertCircle, Loader2, Sparkles, X,
  ChevronLeft, ChevronRight, ShoppingBag
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, query, where, orderBy, getDocs, addDoc, 
  serverTimestamp, updateDoc, doc, getDoc, onSnapshot, limit, setDoc
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
  rating: number;
  totalReviews: number;
}

interface Conversation {
  id: string;
  participants: string[];
  adId: string;
  adTitle: string;
  lastMessage: string;
  lastMessageAt: any;
  unreadCount?: Record<string, number>;
  otherUser?: {
    displayName: string;
    photoURL: string;
  };
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt: any;
}

// --- Components ---

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
  const [view, setView] = useState<'home' | 'details' | 'create' | 'profile' | 'chats' | 'chatroom'>('home');
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [activeChat, setActiveChat] = useState<Conversation | null>(null);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeCondition, setActiveCondition] = useState<string | null>(null);
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');

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
            rating: 5,
            totalReviews: 0,
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
        // We could show a custom toast here
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

  const handleLogout = () => signOut(auth);

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
      return matchesSearch && matchesCondition && matchesCity;
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
  }, [ads, searchQuery, activeCondition, activeCity, sortBy]);

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

  // --- UI Renderers ---
  return (
    <div className="min-h-screen pb-20 flex flex-col max-w-md mx-auto bg-white shadow-xl relative overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-brand-border px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-brand-primary rounded-xl flex items-center justify-center">
            <ShoppingBag className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-[#444432] tracking-tight">سوق الرافدين</h1>
        </div>
        
        {user ? (
          <button 
            onClick={() => setView('profile')}
            className="w-10 h-10 rounded-full overflow-hidden border-2 border-brand-primary/20 shrink-0"
          >
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
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
            />
          )}

          {view === 'profile' && user && (
            <ProfileView 
              user={user} 
              profile={profile}
              onLogout={handleLogout}
              onBack={() => setView('home')}
            />
          )}

          {view === 'chats' && user && (
            <ChatListView 
              user={user}
              onChatSelect={(chat: Conversation) => {
                setActiveChat(chat);
                setView('chatroom');
              }}
            />
          )}

          {view === 'chatroom' && user && activeChat && (
            <ChatRoomView 
              user={user}
              chat={activeChat}
              onBack={() => setView('chats')}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-brand-border py-4 px-6 flex justify-between items-center z-40 rounded-t-3xl shadow-xl">
        <NavButton active={view === 'home'} onClick={() => setView('home')} icon={<Home />} label="الرئيسية" />
        <NavButton active={view === 'chats'} onClick={() => user ? setView('chats') : handleLogin()} icon={<MessageSquare />} label="الرسائل" />
        <button 
          onClick={() => user ? setView('create') : handleLogin()}
          className="w-14 h-14 bg-brand-primary text-white rounded-2xl flex items-center justify-center shadow-2xl shadow-brand-primary/40 -translate-y-6 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus className="w-8 h-8" />
        </button>
        <NavButton active={view === 'profile'} onClick={() => user ? setView('profile') : handleLogin()} icon={<User />} label="حسابي" />
      </nav>
    </div>
  );
}

// --- Chat Subviews ---

function ChatListView({ user, onChatSelect }: any) {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'chats'), 
      where('participants', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
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
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user.uid]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 bg-brand-bg min-h-screen"
    >
      <h2 className="text-2xl font-serif font-bold text-[#444432] mb-8">الرسائل</h2>
      
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-primary" /></div>
      ) : chats.length > 0 ? (
        <div className="space-y-4">
          {chats.map(chat => (
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

function ChatRoomView({ user, chat, onBack }: any) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(
        collection(db, 'chats', chat.id, 'messages'),
        orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Message[];
        setMessages(msgs);
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
    return () => unsubscribe();
  }, [chat.id]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;
    setSending(true);

    try {
        const text = newMessage;
        setNewMessage('');
        
        await addDoc(collection(db, 'chats', chat.id, 'messages'), {
            senderId: user.uid,
            text,
            createdAt: serverTimestamp()
        });

        await updateDoc(doc(db, 'chats', chat.id), {
            lastMessage: text,
            lastMessageAt: serverTimestamp()
        });

        // Send Push Notification
        const otherUserId = chat.participants.find((p: string) => p !== user.uid);
        if (otherUserId) {
          const otherUserSnap = await getDoc(doc(db, 'users', otherUserId));
          if (otherUserSnap.exists()) {
            const otherUserData = otherUserSnap.data();
            if (otherUserData.fcmToken) {
              await fetch('/api/notifications/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  token: otherUserData.fcmToken,
                  title: `رسالة جديدة من ${user.displayName}`,
                  body: text,
                  data: { chatId: chat.id, type: 'chat' }
                })
              });
            }
          }
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
            <p className="text-[10px] text-brand-primary font-bold">بخصوص: {chat.adTitle}</p>
          </div>
        </div>
      </div>

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
              "px-4 py-3 rounded-[24px] text-sm shadow-sm",
              msg.senderId === user.uid 
                ? "bg-brand-primary text-white rounded-br-none" 
                : "bg-white border border-brand-border text-[#444432] rounded-bl-none"
            )}>
              {msg.text}
            </div>
            <span className="text-[9px] text-brand-secondary mt-1 px-1">
              {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-brand-border">
        <form onSubmit={sendMessage} className="flex gap-2">
          <input 
            type="text" 
            placeholder="اكتب رسالتك هنا..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="flex-1 bg-brand-muted border-none rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-brand-primary/20 outline-none"
          />
          <button 
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="w-12 h-12 bg-brand-primary text-white rounded-full flex items-center justify-center shadow-lg shadow-brand-primary/20 disabled:opacity-50 transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
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
  searchQuery, setSearchQuery, ads, loading, onAdClick 
}: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-4"
    >
      {/* Search Bar */}
      <div className="relative mb-6">
        <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-secondary w-5 h-5 pointer-events-none" />
        <input 
          type="text" 
          placeholder="ابحث عن (هواتف، أثاث، سيارات...)" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-brand-muted border-none rounded-full py-4 pr-12 pl-6 text-sm focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all"
        />
      </div>

      {/* Advanced Filters */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="relative">
          <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-secondary pointer-events-none" />
          <select 
            value={activeCity || ''}
            onChange={(e) => setActiveCity(e.target.value)}
            className="w-full bg-white border border-brand-border rounded-2xl py-3 pr-10 pl-3 text-xs font-bold text-brand-primary appearance-none outline-none focus:ring-2 focus:ring-brand-primary/10 shadow-sm"
          >
            <option value="">اختر المدينة</option>
            {CITIES.map(city => <option key={city} value={city}>{city}</option>)}
          </select>
        </div>
        <div className="relative">
          <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-secondary pointer-events-none" />
          <select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full bg-white border border-brand-border rounded-2xl py-3 pr-10 pl-3 text-xs font-bold text-brand-primary appearance-none outline-none focus:ring-2 focus:ring-brand-primary/10 shadow-sm"
          >
            {SORT_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      {/* Categories */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-bold text-[#444432]">الفئات</h2>
          <button className="text-brand-primary text-sm font-bold">الكل</button>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
              className={cn(
                "flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all whitespace-nowrap font-medium",
                activeCategory === cat.id 
                  ? "bg-brand-primary border-brand-primary text-white shadow-lg shadow-brand-primary/20" 
                  : "bg-white border-brand-border text-brand-secondary hover:bg-brand-muted"
              )}
            >
              <span className="text-xl leading-none">{cat.icon}</span>
              <span className="text-sm">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Condition Filter */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-brand-secondary">حالة المنتج</h2>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {CONDITIONS.map(cond => (
            <button
              key={cond.id}
              onClick={() => setActiveCondition(activeCondition === cond.id ? null : cond.id)}
              className={cn(
                "px-4 py-2 rounded-full border text-xs font-bold transition-all whitespace-nowrap",
                activeCondition === cond.id 
                  ? "bg-[#5A5A40] border-[#5A5A40] text-white" 
                  : "bg-white border-brand-border text-brand-secondary hover:bg-brand-muted"
              )}
            >
              {cond.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-10 p-6 bg-brand-primary rounded-[40px] flex flex-col gap-6 text-white relative overflow-hidden shadow-xl shadow-brand-primary/20">
        <div className="flex gap-4 items-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center text-3xl">🤖</div>
          <div className="flex-1">
            <h4 className="text-xl font-serif font-bold">مساعد التسعير الذكي</h4>
            <p className="text-white/70 text-xs leading-relaxed">أدخل تفاصيل غرضك وسنقترح عليك السعر الأنسب للسوق العراقي.</p>
          </div>
        </div>
      </div>

      {/* Ads Feed */}
      <div className="mb-6">
        <h2 className="text-2xl font-serif font-bold text-[#444432] mb-6">المعروض حالياً</h2>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
            <p className="text-gray-400">جاري التحميل...</p>
          </div>
        ) : ads.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {ads.map((ad: Ad) => (
              <AdCard key={ad.id} ad={ad} onClick={() => onAdClick(ad)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <ShoppingBag className="w-12 h-12 text-gray-200 mb-2" />
            <p className="text-gray-400">لا توجد إعلانات حالياً</p>
          </div>
        )}
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
  const [submitting, setSubmitting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      const adData: Omit<Ad, 'id'> = {
        title: formData.title,
        description: formData.description,
        price: Number(formData.price),
        category: formData.category,
        condition: formData.condition,
        images: [
          'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=2000&auto=format&fit=crop',
          'https://images.unsplash.com/photo-1592890288564-76628a30a657?q=80&w=2000&auto=format&fit=crop',
          'https://images.unsplash.com/photo-1556656793-062ff987b48e?q=80&w=2000&auto=format&fit=crop'
        ], // Placeholder for MVP
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
      className="p-6 bg-white min-h-screen"
    >
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-gray-800">إضافة إعلان جديد</h2>
        <button onClick={onClose} className="p-2 bg-gray-100 rounded-full">
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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

        <button 
          disabled={submitting}
          className="w-full bg-brand-primary text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-brand-primary/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
          نشر الإعلان
        </button>
      </form>
    </motion.div>
  );
}

function AdDetailsView({ ad, onBack, onStartChat, currentUser }: any) {
  const [sellerRating, setSellerRating] = useState(4.8);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fallback for single image or empty images array
  const images = ad.images && ad.images.length > 0 ? ad.images : ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=2000&auto=format&fit=crop'];

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
      className="bg-brand-bg min-h-screen"
    >
      {/* Photo Header / Carousel */}
      <div className="relative h-[400px] bg-brand-muted overflow-hidden">
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
          <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-1.5 z-20">
            {images.map((_: any, idx: number) => (
              <div 
                key={idx}
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-all",
                  idx === currentImageIndex ? "bg-white w-4" : "bg-white/40"
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
              className="p-2 bg-black/20 backdrop-blur-md rounded-full text-white pointer-events-auto hover:bg-black/40 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button 
              onClick={nextImage}
              className="p-2 bg-black/20 backdrop-blur-md rounded-full text-white pointer-events-auto hover:bg-black/40 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/20 to-transparent z-20">
          <button onClick={onBack} className="p-2 bg-white/40 backdrop-blur-md rounded-full text-white hover:bg-white/60 transition-colors">
            <ChevronRight className="w-6 h-6" />
          </button>
          <div className="flex gap-2">
            <button className="p-2 bg-white/40 backdrop-blur-md rounded-full text-white hover:bg-white/60 transition-colors">
              <Share2 className="w-5 h-5" />
            </button>
            <button className="p-2 bg-white/40 backdrop-blur-md rounded-full text-white hover:bg-white/60 transition-colors">
              <Heart className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Fullscreen Zoom Modal */}
      <AnimatePresence>
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

      <div className="p-6 -mt-10 bg-brand-bg rounded-t-[40px] relative z-10 space-y-8 shadow-[0_-12px_30px_rgba(0,0,0,0.05)]">
        <div>
          <div className="flex items-center gap-2 mb-3">
             <span className="bg-brand-primary text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">{CATEGORIES.find(c => c.id === ad.category)?.label}</span>
             <span className="bg-white border border-brand-border text-brand-secondary text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">{CONDITIONS.find(c => c.id === ad.condition)?.label}</span>
          </div>
          <h2 className="text-3xl font-serif font-bold text-[#444432] mb-3 leading-tight">{ad.title}</h2>
          <p className="text-3xl font-serif font-bold text-brand-primary">
            {ad.price.toLocaleString()} <span className="text-sm font-normal font-sans opacity-60">دينار عراقي</span>
          </p>
        </div>

        <div className="flex items-center gap-4 p-5 bg-white border border-brand-border rounded-[32px] shadow-sm">
          <div className="w-12 h-12 bg-brand-muted rounded-2xl flex items-center justify-center text-brand-primary">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <p className="font-bold text-[#444432]">{ad.location.city}</p>
            <p className="text-[11px] text-brand-secondary">منطقتك الحالية • تسليم يد بيد</p>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-secondary">وصف المنتج</h3>
          <div className="bg-white p-5 rounded-[32px] border border-brand-border text-[#6b6b5d] leading-relaxed text-sm shadow-sm">
            {ad.description || "لا يوجد وصف مفصل لهذا العرض."}
          </div>
        </div>

        {/* Seller Card */}
        <div className="bg-white border border-brand-border rounded-[32px] p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 bg-brand-muted border border-brand-border rounded-full overflow-hidden">
                <img src={`https://ui-avatars.com/api/?name=${ad.sellerName}&background=5A5A40&color=fff`} alt={ad.sellerName} />
              </div>
              <div>
                <p className="font-serif font-bold text-lg text-[#444432]">{ad.sellerName}</p>
                <div className="flex items-center gap-1">
                  <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                  <span className="text-xs font-bold text-[#444432]">{sellerRating}</span>
                  <span className="text-[10px] text-brand-secondary">(12 تقييم)</span>
                </div>
              </div>
            </div>
            <button className="text-brand-primary text-xs font-bold bg-brand-muted px-4 py-2 rounded-xl border border-brand-border">عرض الملف</button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={onStartChat}
            className="flex items-center justify-center gap-3 bg-[#2c2c24] text-white py-4 rounded-[24px] font-bold shadow-lg active:scale-95 transition-all"
          >
            <MessageSquare className="w-5 h-5" />
            دردشة فورية
          </button>
          <a 
            href={`https://wa.me/${ad.whatsappNumber}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-3 bg-brand-primary text-white py-4 rounded-[24px] font-bold shadow-lg shadow-brand-primary/20 active:scale-95 transition-all"
          >
            <Phone className="w-5 h-5" />
            الواتساب
          </a>
        </div>

        {/* Owner Actions */}
        {currentUser && currentUser.uid === ad.sellerId && ad.status !== 'sold' && (
          <button 
            onClick={async () => {
              try {
                await updateDoc(doc(db, 'ads', ad.id), { status: 'sold' });
                // Notify seller as confirmation
                const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
                if (userSnap.exists() && userSnap.data().fcmToken) {
                  await fetch('/api/notifications/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      token: userSnap.data().fcmToken,
                      title: 'مبروك! تم تمييز إعلانك كمباع',
                      body: `لقد قمت بتمييز "${ad.title}" كمباع بنجاح.`
                    })
                  });
                }
              } catch (e) { console.error(e); }
            }}
            className="w-full py-4 border-2 border-brand-primary text-brand-primary rounded-[24px] font-bold hover:bg-brand-primary hover:text-white transition-all flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-5 h-5" />
            تم البيع
          </button>
        )}

        {/* Comments Section */}
        <div className="space-y-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-secondary">التعليقات</h3>
          <CommentSection adId={ad.id} sellerId={ad.sellerId} adTitle={ad.title} currentUser={currentUser} />
        </div>
      </div>
    </motion.div>
  );
}

function CommentSection({ adId, sellerId, adTitle, currentUser }: any) {
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'ads', adId, 'comments'), orderBy('createdAt', 'desc'), limit(10));
    return onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
        text,
        createdAt: serverTimestamp()
      });

      // Notify Seller
      if (currentUser.uid !== sellerId) {
        const sellerSnap = await getDoc(doc(db, 'users', sellerId));
        if (sellerSnap.exists() && sellerSnap.data().fcmToken) {
          await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: sellerSnap.data().fcmToken,
              title: 'تعليق جديد على إعلانك',
              body: `${currentUser.displayName} علّق على "${adTitle}": ${text}`,
              data: { adId, type: 'comment' }
            })
          });
        }
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
          <div key={c.id} className="bg-white p-4 rounded-2xl border border-brand-border text-sm">
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold text-[#444432]">{c.userName}</span>
              <span className="text-[10px] text-brand-secondary">
                {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : '...'}
              </span>
            </div>
            <p className="text-[#6b6b5d]">{c.text}</p>
          </div>
        ))}
        {comments.length === 0 && <p className="text-center text-xs text-brand-secondary opacity-50 py-4">لا توجد تعليقات بعد</p>}
      </div>
    </div>
  );
}

function ProfileView({ user, profile, onLogout, onBack }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="p-6 bg-brand-bg min-h-screen"
    >
      <div className="flex items-center justify-between mb-10">
        <button onClick={onBack} className="p-3 bg-white border border-brand-border rounded-2xl shadow-sm text-brand-primary">
          <ChevronRight className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-serif font-bold text-[#444432]">الملف الشخصي</h2>
        <div className="w-12"></div>
      </div>

      <div className="flex flex-col items-center text-center mb-10">
        <div className="relative mb-6">
          <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-white shadow-xl">
            <img src={user.photoURL} alt={user.displayName} className="w-full h-full object-cover" />
          </div>
          <div className="absolute bottom-1 right-1 w-8 h-8 bg-brand-primary rounded-full border-2 border-white flex items-center justify-center text-white shadow-lg">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <h3 className="text-2xl font-serif font-bold text-[#444432] mb-1">{user.displayName}</h3>
        <p className="text-brand-secondary text-sm mb-6">{user.email}</p>
        
        <div className="flex gap-4 w-full">
          <div className="flex-1 bg-white p-4 rounded-[24px] border border-brand-border shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-secondary mb-1">تقييمك</p>
            <p className="font-serif font-bold text-xl text-brand-primary flex items-center gap-1 justify-center">
               {profile?.rating || 5} <Star className="w-4 h-4 fill-brand-primary" />
            </p>
          </div>
          <div className="flex-1 bg-white p-4 rounded-[24px] border border-brand-border shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-secondary mb-1">إعلاناتك</p>
            <p className="font-serif font-bold text-xl text-[#444432]">4</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <MenuButton icon={<ShoppingBag className="text-blue-500" />} label="إعلاناتي" />
        <MenuButton icon={<Heart className="text-red-500" />} label="المفضلة" />
        <MenuButton icon={<Star className="text-yellow-500" />} label="تقييماتي" />
        <MenuButton icon={<MapPin className="text-orange-500" />} label="عناوين الشحن" />
      </div>

      <button 
        onClick={onLogout}
        className="w-full bg-red-50 text-red-500 py-4 rounded-2xl font-bold mt-12 mb-4"
      >
        تسجيل الخروج
      </button>
    </motion.div>
  );
}

// --- Atomic Components ---

function AdCard({ ad, onClick }: { ad: Ad, onClick: () => void }) {
  return (
    <motion.div 
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="bg-white rounded-[32px] overflow-hidden border border-brand-border shadow-sm hover:shadow-md transition-all group"
    >
      <div className="relative aspect-[4/5] bg-brand-muted">
        <img src={ad.images[0]} alt={ad.title} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
        <button 
          onClick={(e) => { e.stopPropagation(); }}
          className="absolute top-3 left-3 p-2 bg-white/80 backdrop-blur rounded-full shadow-sm text-brand-secondary hover:text-red-500 transition-colors"
        >
          <Heart className="w-4 h-4" />
        </button>
        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur px-2 py-1 rounded-lg text-[10px] font-bold shadow-sm">
          {CONDITIONS.find(c => c.id === ad.condition)?.label}
        </div>
      </div>
      <div className="p-4 bg-white">
        <h3 className="font-serif font-bold text-[#444432] text-lg mb-1 line-clamp-1">{ad.title}</h3>
        <p className="text-brand-primary font-black text-lg mb-3">
          {ad.price.toLocaleString()} <span className="text-xs font-normal">دينار</span>
        </p>
        <div className="flex justify-between items-center text-[11px] text-brand-secondary">
           <span className="flex items-center gap-1">
             <MapPin className="w-3 h-3" />
             {ad.location.city}
           </span>
           <span className="flex items-center gap-1 bg-brand-muted px-2 py-0.5 rounded-full">
             🌟 4.9
           </span>
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
        "flex flex-col items-center gap-1 transition-all",
        active ? "text-brand-primary" : "text-gray-400"
      )}
    >
      {React.cloneElement(icon, { className: cn("w-6 h-6", active && "fill-brand-primary/10") })}
      <span className="text-[10px] font-bold">{label}</span>
      {active && <motion.div layoutId="nav-dot" className="w-1 h-1 bg-brand-primary rounded-full" />}
    </button>
  );
}

function MenuButton({ icon, label }: any) {
  return (
    <button className="w-full flex items-center justify-between p-5 bg-white border border-brand-border rounded-[24px] hover:bg-brand-muted transition-all shadow-sm active:scale-[0.98]">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-brand-muted rounded-xl flex items-center justify-center text-brand-primary">
          {icon}
        </div>
        <span className="font-bold text-[#444432] text-sm">{label}</span>
      </div>
      <ChevronLeft className="text-brand-secondary w-5 h-5" />
    </button>
  );
}

