"use client";

import { useState, useCallback, useMemo, createContext, useContext, type ReactNode } from "react";

export interface StoredNote {
  commitment: string;
  noteExport: string;
  amountSats: number;
  taprootAddress: string;
  createdAt: number;
  expiresAt: number;
  secretNote?: string; // User's secret note for claiming
  // Poseidon-based commitment for ZK proofs
  poseidonCommitment?: string;
  poseidonNote?: {
    amount: string;
    nullifier: string;
    secret: string;
    // Optional: In Noir mode, commitment is computed inside the circuit
    commitment?: string;
  };
}

interface NoteStorageContextValue {
  notes: StoredNote[];
  isLoaded: boolean;
  saveNote: (note: Omit<StoredNote, "createdAt">) => boolean;
  getNote: (commitment: string) => StoredNote | undefined;
  deleteNote: (commitment: string) => boolean;
  clearNotes: () => boolean;
  getActiveNotes: () => StoredNote[];
}

const NoteStorageContext = createContext<NoteStorageContextValue | null>(null);

/**
 * Provider for in-memory note storage
 * Notes are ONLY stored in memory - nothing persists to localStorage
 * This keeps user secrets private and secure
 */
export function NoteStorageProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [isLoaded] = useState(true);

  // Memoized index map for O(1) lookups
  const noteMap = useMemo(
    () => new Map(notes.map((note) => [note.commitment, note])),
    [notes]
  );

  /**
   * Save a new note to memory
   */
  const saveNote = useCallback(
    (note: Omit<StoredNote, "createdAt">) => {
      const newNote: StoredNote = {
        ...note,
        createdAt: Date.now(),
      };

      setNotes(prev => [...prev, newNote]);
      return true;
    },
    []
  );

  /**
   * Get a note by commitment hash - O(1) lookup using memoized Map
   */
  const getNote = useCallback(
    (commitment: string): StoredNote | undefined => {
      return noteMap.get(commitment);
    },
    [noteMap]
  );

  /**
   * Delete a note by commitment hash (e.g., after successful mint)
   */
  const deleteNote = useCallback(
    (commitment: string) => {
      setNotes(prev => prev.filter(note => note.commitment !== commitment));
      return true;
    },
    []
  );

  /**
   * Clear all notes from memory
   */
  const clearNotes = useCallback(() => {
    setNotes([]);
    return true;
  }, []);

  /**
   * Get all active (non-expired) notes
   */
  const getActiveNotes = useCallback(() => {
    const now = Date.now();
    return notes.filter((note) => note.expiresAt * 1000 > now);
  }, [notes]);

  const value: NoteStorageContextValue = {
    notes,
    isLoaded,
    saveNote,
    getNote,
    deleteNote,
    clearNotes,
    getActiveNotes,
  };

  return (
    <NoteStorageContext.Provider value={value}>
      {children}
    </NoteStorageContext.Provider>
  );
}

/**
 * Hook for managing note storage in memory
 * Notes are kept ONLY for the current session - nothing is persisted
 * This ensures user privacy and security
 */
export function useNoteStorage(): NoteStorageContextValue {
  const context = useContext(NoteStorageContext);

  // Fallback for when used outside provider (shouldn't happen in normal use)
  const [notes, setNotes] = useState<StoredNote[]>([]);

  const noteMap = useMemo(
    () => new Map(notes.map((note) => [note.commitment, note])),
    [notes]
  );

  const fallbackValue: NoteStorageContextValue = {
    notes,
    isLoaded: true,
    saveNote: (note) => {
      setNotes(prev => [...prev, { ...note, createdAt: Date.now() }]);
      return true;
    },
    getNote: (commitment) => noteMap.get(commitment),
    deleteNote: (commitment) => {
      setNotes(prev => prev.filter(n => n.commitment !== commitment));
      return true;
    },
    clearNotes: () => {
      setNotes([]);
      return true;
    },
    getActiveNotes: () => {
      const now = Date.now();
      return notes.filter((note) => note.expiresAt * 1000 > now);
    },
  };

  return context ?? fallbackValue;
}
