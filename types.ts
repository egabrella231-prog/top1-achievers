
export type Level = 'NSSCO' | 'NSSCAS';
export type UserStatus = 'pending' | 'approved' | 'revoked';

export type Subject = 
  | 'Mathematics' 
  | 'Physics' 
  | 'Chemistry' 
  | 'Biology' 
  | 'English' 
  | 'Economics' 
  | 'Accounting' 
  | 'Geography'
  | 'Business Studies'
  | 'History' 
  | 'Development Studies'
  | 'Agriculture'
  | 'Computer Studies'
  | 'Entrepreneurship';

// GroundingChunk matches the SDK's metadata structure for search grounding
export interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  groundingChunks?: GroundingChunk[];
}

export interface SubjectOption {
  id: Subject;
  level: Level;
  icon: string;
  color: string;
  description: string;
}

export interface AppUser {
  id: string;
  name: string;
  phone: string;
  email?: string; // For admin
  password: string;
  status: UserStatus;
  isAdmin?: boolean;
}