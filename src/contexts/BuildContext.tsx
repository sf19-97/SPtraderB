import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

interface LastOpenedComponent {
  type: string;
  name: string;
  path?: string;
}

interface BuildContextType {
  // Search and filter state
  searchTerm: string;
  selectedCategory: string;
  scrollPosition: number;
  
  // Component tracking
  lastOpenedComponent: LastOpenedComponent | null;
  recentComponents: LastOpenedComponent[];
  
  // Actions
  setSearchTerm: (term: string) => void;
  setSelectedCategory: (category: string) => void;
  setScrollPosition: (position: number) => void;
  setLastOpenedComponent: (component: LastOpenedComponent | null) => void;
  addToRecentComponents: (component: LastOpenedComponent) => void;
}

const BuildContext = createContext<BuildContextType | undefined>(undefined);

// LocalStorage keys
const STORAGE_KEYS = {
  searchTerm: 'build_searchTerm',
  selectedCategory: 'build_selectedCategory',
  recentComponents: 'build_recentComponents',
};

export const BuildProvider = ({ children }: { children: ReactNode }) => {
  // Initialize state from localStorage or defaults
  const [searchTerm, setSearchTerm] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.searchTerm) || '';
  });
  
  const [selectedCategory, setSelectedCategory] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.selectedCategory) || 'all';
  });
  
  const [scrollPosition, setScrollPosition] = useState(0);
  const [lastOpenedComponent, setLastOpenedComponent] = useState<LastOpenedComponent | null>(null);
  
  const [recentComponents, setRecentComponents] = useState<LastOpenedComponent[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.recentComponents);
    return stored ? JSON.parse(stored) : [];
  });

  // Persist to localStorage when values change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.searchTerm, searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.selectedCategory, selectedCategory);
  }, [selectedCategory]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.recentComponents, JSON.stringify(recentComponents));
  }, [recentComponents]);

  const addToRecentComponents = (component: LastOpenedComponent) => {
    setRecentComponents(prev => {
      // Remove if already exists to avoid duplicates
      const filtered = prev.filter(c => 
        !(c.type === component.type && c.name === component.name)
      );
      // Add to beginning and limit to 10 items
      return [component, ...filtered].slice(0, 10);
    });
  };

  return (
    <BuildContext.Provider value={{
      searchTerm,
      selectedCategory,
      scrollPosition,
      lastOpenedComponent,
      recentComponents,
      // Actions
      setSearchTerm,
      setSelectedCategory,
      setScrollPosition,
      setLastOpenedComponent,
      addToRecentComponents,
    }}>
      {children}
    </BuildContext.Provider>
  );
};

export const useBuild = () => {
  const context = useContext(BuildContext);
  if (!context) throw new Error('useBuild must be used within BuildProvider');
  return context;
};