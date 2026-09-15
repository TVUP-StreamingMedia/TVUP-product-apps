
export enum UserRole {
  USER = 'USER',
  PRODUCT = 'PRODUCT_TEAM',
  ADMIN = 'ADMIN',
  CTO = 'CTO'
}

export enum IdeaStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  REVIEWING = 'REVIEWING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export type MoSCoW = 'Must' | 'Should' | 'Could' | "Won't";
export type Level = 'low' | 'medium' | 'high';
export type SeedType = 'Product' | 'Technical' | 'Business';

export interface ImpactSection {
  s1: Level;
  s2: Level;
  s3: Level;
}

export interface User {
  id: string;
  name: string;
  email: string;
  notificationEmail?: string;
  password?: string;
  role: UserRole;
  avatar?: string;
  avatarUrl?: string;
  photoURL?: string;
  provider?: string;
  lastLogin?: string;
}

export interface IdeaVote {
  userId: string;
  userName: string;
  userRole: UserRole;
  businessImpact: ImpactSection;
  traction: ImpactSection;
  engagement: ImpactSection;
  virality: ImpactSection;
  technicalImpact?: ImpactSection;
  feasibility?: ImpactSection;
  scalability?: ImpactSection;
  // Business Seed fields
  revenuePotential?: ImpactSection;
  distributionPower?: ImpactSection;
  marketValidation?: ImpactSection;
  strategicPositioning?: ImpactSection;
  score: number;
  timestamp: string;
  comment?: string;
}

export interface IdeaData {
  seedName: string;
  oneSentenceSummary: string;
  seedType: SeedType;
  businessUnit: string[];
  isClientRequest?: boolean;
  isLegalRequirement?: boolean;
  isPilot?: boolean;
  clientName?: string;
  elevatorPitch: {
    problem: string;
    solution: string;
  };
  expectedBenefits: {
    endUser: string;
    forUs: string;
  };
  costOfNotDoing: string;
  // Scoring fields grouped by section
  businessImpact: ImpactSection;
  engagement: ImpactSection;
  traction: ImpactSection;
  virality: ImpactSection;
  // Scoring fields - Technical
  technicalImpact?: ImpactSection;
  feasibility?: ImpactSection;
  scalability?: ImpactSection;
  // Scoring fields - Business
  revenuePotential?: ImpactSection;
  distributionPower?: ImpactSection;
  marketValidation?: ImpactSection;
  strategicPositioning?: ImpactSection;
  // Calculated fields
  calculatedScore: number;
  moscow: MoSCoW;
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  supportLinks?: string[];
}

export interface Idea {
  id: string;
  userId: string;
  authorName: string;
  date: string;
  status: IdeaStatus;
  updatedAt?: string;
  data: IdeaData;
  votes: IdeaVote[];
  consensusScore?: number;
  voteCount?: number;
}

export type Language = 'en' | 'es';

export type InitiativeStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'ready_for_roadmap';

export interface InitiativeData {
  id?: string;
  seedId: string;           // reference to the originating seed id
  seedName: string;         // copied from seed for display
  createdByUserId: string;
  createdByUserName: string;
  createdAt: string;
  updatedAt: string;
  status: InitiativeStatus;

  // MAIN section (from PDF: Plantilla Iniciativa de Innovacion)
  title: string;                         // Titulo iniciativa
  shortDescription: string;              // Breve descripcion 50 palabras
  proponentName: string;                 // Name and Surname
  sponsorName: string;                   // Name and Surname
  collaborators: string;                // Changed from string[] to string
  involvedAreas: string;                // Changed from string[] to string
  businessUnits: string[];               // BU, BU
  elevatorPitchProblem: string;          // Problem/opportunity - Highlights
  elevatorPitchSolution: string;         // Solution - Highlights
  expectedBenefitsEndUser: string;       // For the end user
  expectedBenefitsInternalClients: string; // For the internal clients
  expectedBenefitsUs: string;            // For us
  costOfNotDoing: string;               // Description

  // EXPLORATION section (SWOT)
  strengths: string[];                  // Changed from string to string[]
  opportunities: string[];              // Changed from string to string[]
  weaknesses: string[];                 // Changed from string to string[]
  threats: string[];                    // Changed from string to string[]

  // ECONOMIC SIZE section
  developmentCosts: number;
  developmentCostsExplanation?: string;
  operationalCosts: number;
  operationalCostsExplanation?: string;
  npv3Years: number;
  npvExplanation?: string;
  payback: number;
  paybackExplanation?: string;
  economicExplanation?: string;         // General logic explanation

  // STRATEGIC FIT section
  strategicFitOverall: number;           // e.g. 100 (fits 100%)
  financialScore: number;
  clientScore: number;
  internalScore: number;
  learningScore: number;
  strategicScore: number;               // e.g. 2.49

  // ECONOMIC ANALYSIS (CFO only, when total cost > 50k euros)
  requiresCfoAnalysis: boolean;
  cfoAnalysis: string;
  cfoReviewedAt?: string;
  cfoReviewerId?: string;
  supportLinks?: string[];
}
