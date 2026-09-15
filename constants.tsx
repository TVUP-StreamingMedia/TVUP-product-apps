
import { IdeaStatus, MoSCoW, Level, ImpactSection } from './types';

export const COLORS = {
  primary: '#1e293b', // slate-800
  accent: '#f97316',  // orange-500
  secondary: '#0f172a', // slate-900
};

// Helper to create a default impact section with the same level for all sub-metrics
const defaultSection = (lvl: Level): ImpactSection => ({ s1: lvl, s2: lvl, s3: lvl });

export const INITIAL_IDEAS: any[] = [
  {
    id: '1',
    userId: 'user-1',
    authorName: 'Juan Pérez',
    date: '2024-05-15',
    status: IdeaStatus.PENDING,
    votes: [],
    data: {
      seedName: 'Personalización de Canales AI',
      businessUnit: ['B2C'],
      elevatorPitch: {
        problem: 'Los usuarios tardan demasiado en encontrar contenido relevante.',
        solution: 'Implementar un algoritmo que cree una parrilla personalizada dinámica.'
      },
      expectedBenefits: {
        endUser: 'Mayor satisfacción y retención.',
        forUs: 'Diferenciación competitiva y nuevos insights de comportamiento.'
      },
      costOfNotDoing: 'Pérdida de usuarios frente a plataformas más modernas.',
      businessImpact: defaultSection('high'),
      engagement: defaultSection('high'),
      traction: defaultSection('medium'),
      virality: defaultSection('low'),
      calculatedScore: 8.2,
      moscow: 'Must' as MoSCoW,
      swot: {
        strengths: ['Datos ya disponibles.'],
        weaknesses: ['Complejidad técnica.'],
        opportunities: ['Nuevos partners.'],
        threats: ['Regulaciones de privacidad.']
      }
    }
  }
];
