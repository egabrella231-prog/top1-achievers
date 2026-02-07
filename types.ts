
export type Level = 'NSSCO' | 'NSSCAS';

// Expanded Subject type to include all subjects offered in the Namibian NSSC curriculum as used in constants.tsx
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

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
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
