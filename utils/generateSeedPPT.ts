import pptxgen from 'pptxgenjs';
import { Idea, User, UserRole } from '../types';
import { translations } from '../translations';

const getLevelValue = (level: string): number => {
  switch (level) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 1;
  }
};

const calculateRawAvgSection = (sections: any[]): number => {
  const validSections = sections.filter(s => !!s && !!s.s1 && !!s.s2 && !!s.s3);
  if (validSections.length === 0) return 0;
  const s1 = validSections.reduce((acc, s) => acc + getLevelValue(s.s1), 0) / validSections.length;
  const s2 = validSections.reduce((acc, s) => acc + getLevelValue(s.s2), 0) / validSections.length;
  const s3 = validSections.reduce((acc, s) => acc + getLevelValue(s.s3), 0) / validSections.length;
  return (s1 + s2 + s3) / 3;
};

const scaleTo10 = (val: number) => (val - 1) * 4.5 + 1;

const calculateAvgSection = (sections: any[]): number => {
  const raw = calculateRawAvgSection(sections);
  if (raw === 0) return 0;
  return scaleTo10(raw);
};

const getMoSCoWFromScore = (score: number): string => {
  if (score >= 8.0) return 'Must';
  if (score >= 6.5) return 'Should';
  if (score >= 5.0) return 'Could';
  return "Won't";
};

export const generateSeedPPT = async (idea: Idea, users: User[], lang: 'en' | 'es') => {
  const t = translations[lang];
  const pptx = new pptxgen();

  pptx.layout = 'LAYOUT_16x9';

  pptx.defineSlideMaster({
    title: 'MASTER_SLIDE',
    background: { color: 'FFFFFF' },
    objects: [
      {
        text: {
          text: 'TVUP',
          options: { x: 8.5, y: 0.2, w: 1.0, h: 0.5, fontSize: 16, bold: true, color: '0A192F', align: 'right' }
        }
      }
    ]
  });

  // Calculate consensus score
  const author = users.find(u => u.id === idea.userId);
  const isAuthorProduct = author?.role?.toUpperCase() === 'ADMIN' || author?.role?.toUpperCase() === 'PRODUCT' || author?.role?.toUpperCase() === 'PRODUCT_TEAM';

  let consensusVotes = idea.votes.filter(v => {
    if (v.userId === idea.userId) return false;
    const voterRole = v.userRole || users.find(u => u.id === v.userId)?.role;
    return voterRole?.toUpperCase() === 'ADMIN' || voterRole?.toUpperCase() === 'PRODUCT' || voterRole?.toUpperCase() === 'PRODUCT_TEAM';
  }).map(v => ({
    businessImpact: v.businessImpact,
    engagement: v.engagement,
    traction: v.traction,
    virality: v.virality
  }));

  if (isAuthorProduct) {
    consensusVotes.push({
      businessImpact: idea.data.businessImpact,
      engagement: idea.data.engagement,
      traction: idea.data.traction,
      virality: idea.data.virality
    });
  }

  const allBiz = consensusVotes.map(v => v.businessImpact);
  const allEng = consensusVotes.map(v => v.engagement);
  const allTra = consensusVotes.map(v => v.traction);
  const allVir = consensusVotes.map(v => v.virality);

  const avgBiz = consensusVotes.length > 0 ? calculateRawAvgSection(allBiz) : 0;
  const avgEng = consensusVotes.length > 0 ? calculateRawAvgSection(allEng) : 0;
  const avgTra = consensusVotes.length > 0 ? calculateRawAvgSection(allTra) : 0;
  const avgVir = consensusVotes.length > 0 ? calculateRawAvgSection(allVir) : 0;

  let consensusScore = 0;
  if (consensusVotes.length > 0) {
    const cubicScore = Math.cbrt(0.3 * Math.pow(avgBiz, 3) + 0.3 * Math.pow(avgEng, 3) + 0.2 * Math.pow(avgTra, 3) + 0.2 * Math.pow(avgVir, 3));
    consensusScore = Math.round(scaleTo10(cubicScore) * 10) / 10;
  }

  const moscow = getMoSCoWFromScore(consensusScore);

  // Slide 1: Main Info
  const slide1 = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
  slide1.addText('TVUP', { x: 0.5, y: 0.2, w: 2.0, h: 0.5, fontSize: 24, bold: true, color: 'F97316' });
  
  const mainTableData = [
    [{ text: t.wizard.ideaName, options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: idea.data.seedName || '' }],
    [{ text: t.wizard.oneSentenceSummary, options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: idea.data.oneSentenceSummary || '' }],
    [{ text: 'Proponent', options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: idea.authorName || '' }],
    [{ text: t.wizard.businessUnit, options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: (idea.data.businessUnit || []).join(', ') }],
    [{ text: t.wizard.elevatorPitch, options: { bold: true, fill: { color: 'F8FAFC' }, colspan: 2 } }],
    [{ text: t.wizard.problem, options: { bold: true, align: 'right' } }, { text: idea.data.elevatorPitch?.problem || '' }],
    [{ text: t.wizard.solution, options: { bold: true, align: 'right' } }, { text: idea.data.elevatorPitch?.solution || '' }],
    [{ text: t.wizard.benefits, options: { bold: true, fill: { color: 'F8FAFC' }, colspan: 2 } }],
    [{ text: t.wizard.forUser, options: { bold: true, align: 'right' } }, { text: idea.data.expectedBenefits?.endUser || '' }],
    [{ text: t.wizard.forUs, options: { bold: true, align: 'right' } }, { text: idea.data.expectedBenefits?.forUs || '' }],
    [{ text: t.wizard.costNotDoing, options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: idea.data.costOfNotDoing || '' }],
  ];

  slide1.addTable(mainTableData as any, {
    x: 0.5, y: 0.8, w: 9.0,
    border: { type: 'solid', color: 'E2E8F0', pt: 1 },
    colW: [2.0, 7.0],
    fontSize: 10,
    color: '0A192F',
    valign: 'middle'
  });

  // Slide 2: SWOT & Metrics
  const slide2 = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
  slide2.addText('Exploration & Metrics', { x: 0.5, y: 0.2, w: 5.0, h: 0.5, fontSize: 24, bold: true, color: '0A192F' });

  const formatList = (items: string[]) => items && items.length > 0 ? items.map(i => `• ${i}`).join('\n') : '-';

  // SWOT
  slide2.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.8, w: 2.8, h: 2.0, fill: { color: 'ECFDF5' }, rectRadius: 0.1 });
  slide2.addText(t.wizard.strengths, { x: 0.6, y: 0.9, w: 2.6, h: 0.3, fontSize: 14, bold: true, color: '064E3B' });
  slide2.addText(formatList(idea.data.swot?.strengths || []), { x: 0.6, y: 1.2, w: 2.6, h: 1.5, fontSize: 10, color: '0A192F', valign: 'top' });

  slide2.addShape(pptx.ShapeType.rect, { x: 3.5, y: 0.8, w: 2.8, h: 2.0, fill: { color: 'ECFDF5' }, rectRadius: 0.1 });
  slide2.addText(t.wizard.opportunities, { x: 3.6, y: 0.9, w: 2.6, h: 0.3, fontSize: 14, bold: true, color: '064E3B' });
  slide2.addText(formatList(idea.data.swot?.opportunities || []), { x: 3.6, y: 1.2, w: 2.6, h: 1.5, fontSize: 10, color: '0A192F', valign: 'top' });

  slide2.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.0, w: 2.8, h: 2.0, fill: { color: 'FFF7ED' }, rectRadius: 0.1 });
  slide2.addText(t.wizard.weaknesses, { x: 0.6, y: 3.1, w: 2.6, h: 0.3, fontSize: 14, bold: true, color: '9A3412' });
  slide2.addText(formatList(idea.data.swot?.weaknesses || []), { x: 0.6, y: 3.4, w: 2.6, h: 1.5, fontSize: 10, color: '0A192F', valign: 'top' });

  slide2.addShape(pptx.ShapeType.rect, { x: 3.5, y: 3.0, w: 2.8, h: 2.0, fill: { color: 'FFF7ED' }, rectRadius: 0.1 });
  slide2.addText(t.wizard.threats, { x: 3.6, y: 3.1, w: 2.6, h: 0.3, fontSize: 14, bold: true, color: '9A3412' });
  slide2.addText(formatList(idea.data.swot?.threats || []), { x: 3.6, y: 3.4, w: 2.6, h: 1.5, fontSize: 10, color: '0A192F', valign: 'top' });

  // Metrics
  slide2.addShape(pptx.ShapeType.rect, { x: 6.5, y: 0.8, w: 3.0, h: 4.2, fill: { color: 'F8FAFC' }, rectRadius: 0.1 });
  slide2.addText(t.wizard.metrics, { x: 6.6, y: 0.9, w: 2.8, h: 0.3, fontSize: 14, bold: true, color: '0A192F' });
  
  slide2.addText('Score', { x: 6.6, y: 1.4, w: 1.4, h: 0.3, fontSize: 12, color: '64748B' });
  slide2.addText(consensusScore.toString(), { x: 6.6, y: 1.7, w: 1.4, h: 0.6, fontSize: 24, bold: true, color: 'F97316' });

  slide2.addText('MoSCoW', { x: 8.0, y: 1.4, w: 1.4, h: 0.3, fontSize: 12, color: '64748B' });
  slide2.addText(moscow, { x: 8.0, y: 1.7, w: 1.4, h: 0.6, fontSize: 20, bold: true, color: '10B981' });

  const isTechnical = idea.data.seedType === 'Technical';
  const metricsData = [
    [{ text: t.wizard.impactVectors.business.title, options: { bold: true } }, { text: (Math.round(avgBiz * 10) / 10).toFixed(1) }],
    [{ text: isTechnical ? t.wizard.impactVectors.stability.title : t.wizard.impactVectors.engagement.title, options: { bold: true } }, { text: (Math.round(avgEng * 10) / 10).toFixed(1) }],
    [{ text: isTechnical ? t.wizard.impactVectors.enablement.title : t.wizard.impactVectors.virality.title, options: { bold: true } }, { text: (Math.round(avgVir * 10) / 10).toFixed(1) }],
    [{ text: isTechnical ? t.wizard.impactVectors.risk.title : t.wizard.impactVectors.traction.title, options: { bold: true } }, { text: (Math.round(avgTra * 10) / 10).toFixed(1) }],
  ];

  slide2.addTable(metricsData as any, {
    x: 6.6, y: 2.6, w: 2.8,
    border: { type: 'solid', color: 'E2E8F0', pt: 1 },
    colW: [2.0, 0.8],
    fontSize: 10,
    color: '0A192F',
  });

  pptx.writeFile({ fileName: `Seed - ${idea.data.seedName}.pptx` });
};
