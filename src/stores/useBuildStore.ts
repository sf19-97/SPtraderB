import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface BuildComponent {
  name: string;
  type: 'indicator' | 'signal' | 'strategy';
  path: string;
  description?: string;
  category?: string;
  tags?: string[];
  author?: string;
  version?: string;
  lastModified?: string;
}

interface BuildState {
  // Search and filters
  searchTerm: string;
  selectedCategory: string | null;
  selectedTags: string[];
  
  // Component management
  recentComponents: BuildComponent[];
  favoriteComponents: string[]; // paths
  
  // UI state
  viewMode: 'grid' | 'list';
  sortBy: 'name' | 'modified' | 'type';
  sortOrder: 'asc' | 'desc';
  scrollPosition: number;
  
  // IDE state
  openFiles: string[];
  activeFile: string | null;
  
  // Actions
  setSearchTerm: (term: string) => void;
  setSelectedCategory: (category: string | null) => void;
  toggleTag: (tag: string) => void;
  addRecentComponent: (component: BuildComponent) => void;
  toggleFavorite: (path: string) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setSortBy: (sortBy: 'name' | 'modified' | 'type') => void;
  toggleSortOrder: () => void;
  setScrollPosition: (position: number) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  reset: () => void;
}

const initialState = {
  searchTerm: '',
  selectedCategory: null,
  selectedTags: [],
  recentComponents: [],
  favoriteComponents: [],
  viewMode: 'grid' as const,
  sortBy: 'name' as const,
  sortOrder: 'asc' as const,
  scrollPosition: 0,
  openFiles: [],
  activeFile: null,
};

export const useBuildStore = create<BuildState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        setSearchTerm: (searchTerm) => set({ searchTerm }),
        
        setSelectedCategory: (category) => set({ selectedCategory: category }),
        
        toggleTag: (tag) => 
          set((state) => ({
            selectedTags: state.selectedTags.includes(tag)
              ? state.selectedTags.filter(t => t !== tag)
              : [...state.selectedTags, tag]
          })),
        
        addRecentComponent: (component) => 
          set((state) => {
            const filtered = state.recentComponents.filter(c => c.path !== component.path);
            const newRecent = [component, ...filtered].slice(0, 10); // Keep last 10
            return { recentComponents: newRecent };
          }),
        
        toggleFavorite: (path) => 
          set((state) => ({
            favoriteComponents: state.favoriteComponents.includes(path)
              ? state.favoriteComponents.filter(p => p !== path)
              : [...state.favoriteComponents, path]
          })),
        
        setViewMode: (viewMode) => set({ viewMode }),
        
        setSortBy: (sortBy) => set({ sortBy }),
        
        toggleSortOrder: () => 
          set((state) => ({
            sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc'
          })),
        
        setScrollPosition: (position) => set({ scrollPosition: position }),
        
        openFile: (path) => 
          set((state) => ({
            openFiles: state.openFiles.includes(path) 
              ? state.openFiles 
              : [...state.openFiles, path],
            activeFile: path
          })),
        
        closeFile: (path) => 
          set((state) => {
            const newOpenFiles = state.openFiles.filter(f => f !== path);
            const newActiveFile = state.activeFile === path 
              ? newOpenFiles[newOpenFiles.length - 1] || null
              : state.activeFile;
            return {
              openFiles: newOpenFiles,
              activeFile: newActiveFile
            };
          }),
        
        setActiveFile: (path) => set({ activeFile: path }),
        
        reset: () => set(initialState),
      }),
      {
        name: 'build-store',
        partialize: (state) => ({
          // Persist UI preferences and favorites
          viewMode: state.viewMode,
          sortBy: state.sortBy,
          sortOrder: state.sortOrder,
          favoriteComponents: state.favoriteComponents,
          recentComponents: state.recentComponents,
        }),
      }
    )
  )
);