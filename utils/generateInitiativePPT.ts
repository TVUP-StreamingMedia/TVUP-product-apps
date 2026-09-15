import pptxgen from 'pptxgenjs';
import { InitiativeData } from '../types';

export const generateInitiativePPT = async (initiative: InitiativeData) => {
  const pptx = new pptxgen();

  // Common slide settings (16:9 is 10 x 5.625 inches)
  pptx.layout = 'LAYOUT_16x9';

  // Define master slide for common elements (like logo)
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

  // Slide 1: Title
  const slide1 = pptx.addSlide();
  slide1.addText('TVUP', { x: 1.0, y: 1.5, w: 5.0, h: 0.5, fontSize: 24, bold: true, color: 'F97316' }); // Orange logo placeholder
  slide1.addText(initiative.title || 'Título iniciativa', {
    x: 1.0, y: 2.2, w: 8.0, h: 1.0, fontSize: 40, bold: true, color: '0A192F'
  });
  slide1.addText(initiative.shortDescription || 'Breve descripción de la iniciativa en 50 palabras', {
    x: 1.0, y: 3.3, w: 8.0, h: 1.5, fontSize: 18, color: '0A192F', valign: 'top'
  });

  // Slide 2: Main
  const slide2 = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
  slide2.addText('Main', { x: 0.5, y: 0.2, w: 5.0, h: 0.5, fontSize: 24, bold: true, color: '0A192F' });

  const mainTableData = [
    [{ text: 'Name', options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: initiative.title || '' }],
    [{ text: 'Proponent', options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: initiative.proponentName || '' }],
    [{ text: 'Sponsor', options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: initiative.sponsorName || '' }],
    [{ text: 'Colaborators', options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: initiative.collaborators || '' }],
    [{ text: 'Involved areas', options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: initiative.involvedAreas || '' }],
    [{ text: 'Business Unit', options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: (initiative.businessUnits || []).join(', ') }],
    [{ text: 'Elevator pitch', options: { bold: true, fill: { color: 'F8FAFC' }, colspan: 2 } }],
    [{ text: 'Problem/opportunity', options: { bold: true, align: 'right' } }, { text: initiative.elevatorPitchProblem || '' }],
    [{ text: 'Solution', options: { bold: true, align: 'right' } }, { text: initiative.elevatorPitchSolution || '' }],
    [{ text: 'Expected benefits', options: { bold: true, fill: { color: 'F8FAFC' }, colspan: 2 } }],
    [{ text: 'For the end user', options: { bold: true, align: 'right' } }, { text: initiative.expectedBenefitsEndUser || '' }],
    [{ text: 'For the internal clients', options: { bold: true, align: 'right' } }, { text: initiative.expectedBenefitsInternalClients || '' }],
    [{ text: 'For TVUP', options: { bold: true, align: 'right' } }, { text: initiative.expectedBenefitsUs || '' }],
    [{ text: 'Cost of not doing', options: { bold: true, fill: { color: 'F8FAFC' } } }, { text: initiative.costOfNotDoing || '' }],
  ];

  slide2.addTable(mainTableData as any, {
    x: 0.5, y: 0.8, w: 9.0,
    border: { type: 'solid', color: 'E2E8F0', pt: 1 },
    colW: [2.0, 7.0],
    fontSize: 10,
    color: '0A192F',
    valign: 'middle'
  });

  // Slide 3: Exploration (SWOT)
  const slide3 = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
  slide3.addText('Exploration', { x: 0.5, y: 0.2, w: 5.0, h: 0.5, fontSize: 24, bold: true, color: '0A192F' });

  const formatList = (items: string[]) => items && items.length > 0 ? items.map(i => `• ${i}`).join('\n') : '-';

  // Strengths (Green)
  slide3.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.8, w: 4.3, h: 2.2, fill: { color: 'ECFDF5' }, rectRadius: 0.1 });
  slide3.addText('Strengths', { x: 0.6, y: 0.9, w: 4.1, h: 0.3, fontSize: 16, bold: true, color: '064E3B' });
  slide3.addText(formatList(initiative.strengths), { x: 0.6, y: 1.2, w: 4.1, h: 1.7, fontSize: 10, color: '0A192F', valign: 'top' });

  // Opportunities (Green)
  slide3.addShape(pptx.ShapeType.rect, { x: 5.2, y: 0.8, w: 4.3, h: 2.2, fill: { color: 'ECFDF5' }, rectRadius: 0.1 });
  slide3.addText('Opportunities', { x: 5.3, y: 0.9, w: 4.1, h: 0.3, fontSize: 16, bold: true, color: '064E3B' });
  slide3.addText(formatList(initiative.opportunities), { x: 5.3, y: 1.2, w: 4.1, h: 1.7, fontSize: 10, color: '0A192F', valign: 'top' });

  // Weaknesses (Orange/Red)
  slide3.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.2, w: 4.3, h: 2.2, fill: { color: 'FFF7ED' }, rectRadius: 0.1 });
  slide3.addText('Weaknesses', { x: 0.6, y: 3.3, w: 4.1, h: 0.3, fontSize: 16, bold: true, color: '9A3412' });
  slide3.addText(formatList(initiative.weaknesses), { x: 0.6, y: 3.6, w: 4.1, h: 1.7, fontSize: 10, color: '0A192F', valign: 'top' });

  // Threats (Orange/Red)
  slide3.addShape(pptx.ShapeType.rect, { x: 5.2, y: 3.2, w: 4.3, h: 2.2, fill: { color: 'FFF7ED' }, rectRadius: 0.1 });
  slide3.addText('Threats', { x: 5.3, y: 3.3, w: 4.1, h: 0.3, fontSize: 16, bold: true, color: '9A3412' });
  slide3.addText(formatList(initiative.threats), { x: 5.3, y: 3.6, w: 4.1, h: 1.7, fontSize: 10, color: '0A192F', valign: 'top' });

  const formatNumber = (num: number | undefined | null) => {
    if (num === undefined || num === null) return 0;
    return new Intl.NumberFormat('de-DE').format(num);
  };

  // Slide 4: Economic size
  const slide4 = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
  slide4.addText('Economic size', { x: 0.5, y: 0.2, w: 5.0, h: 0.5, fontSize: 24, bold: true, color: '0A192F' });

  // Dev Costs
  slide4.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.8, w: 4.3, h: 2.2, fill: { color: 'E0F2FE' }, rectRadius: 0.1 });
  slide4.addText('Development costs', { x: 0.7, y: 1.0, w: 3.9, h: 0.4, fontSize: 18, color: '0A192F' });
  slide4.addText(`${formatNumber(initiative.developmentCosts)} EUR`, { x: 0.7, y: 1.4, w: 3.9, h: 0.3, fontSize: 14, bold: true, color: '0A192F' });
  if (initiative.developmentCostsExplanation) {
    slide4.addText(initiative.developmentCostsExplanation, { x: 0.7, y: 1.7, w: 3.9, h: 0.4, fontSize: 9, color: '475569', italic: true, valign: 'top' });
  }
  
  slide4.addText('Operational costs', { x: 0.7, y: 2.1, w: 3.9, h: 0.4, fontSize: 18, color: '0A192F' });
  slide4.addText(`${formatNumber(initiative.operationalCosts)} EUR/mo`, { x: 0.7, y: 2.5, w: 3.9, h: 0.3, fontSize: 14, bold: true, color: '0A192F' });
  if (initiative.operationalCostsExplanation) {
    slide4.addText(initiative.operationalCostsExplanation, { x: 0.7, y: 2.8, w: 3.9, h: 0.4, fontSize: 9, color: '475569', italic: true, valign: 'top' });
  }

  // Opportunity size
  slide4.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.2, w: 4.3, h: 2.2, fill: { color: 'E0F2FE' }, rectRadius: 0.1 });
  slide4.addText('Opportunity size', { x: 0.7, y: 3.4, w: 3.9, h: 0.4, fontSize: 18, color: '0A192F' });
  slide4.addText(initiative.economicExplanation || '-', { x: 0.7, y: 3.8, w: 3.9, h: 1.4, fontSize: 11, color: '0A192F', valign: 'top' });

  // Financial Return (NPV & Payback)
  slide4.addShape(pptx.ShapeType.rect, { x: 5.2, y: 0.8, w: 4.3, h: 2.2, fill: { color: 'E0F2FE' }, rectRadius: 0.1 });
  slide4.addText('NPV 3 Years', { x: 5.4, y: 1.0, w: 3.9, h: 0.4, fontSize: 18, color: '0A192F' });
  slide4.addText(`${formatNumber(initiative.npv3Years)} EUR`, { x: 5.4, y: 1.4, w: 3.9, h: 0.3, fontSize: 14, bold: true, color: '0A192F' });
  if (initiative.npvExplanation) {
    slide4.addText(initiative.npvExplanation, { x: 5.4, y: 1.7, w: 3.9, h: 0.4, fontSize: 9, color: '475569', italic: true, valign: 'top' });
  }
  
  slide4.addText('Payback', { x: 5.4, y: 2.1, w: 3.9, h: 0.4, fontSize: 18, color: '0A192F' });
  slide4.addText(`${formatNumber(initiative.payback)} months`, { x: 5.4, y: 2.5, w: 3.9, h: 0.3, fontSize: 14, bold: true, color: '0A192F' });
  if (initiative.paybackExplanation) {
    slide4.addText(initiative.paybackExplanation, { x: 5.4, y: 2.8, w: 3.9, h: 0.4, fontSize: 9, color: '475569', italic: true, valign: 'top' });
  }

  // Slide 5: Strategic fit
  const slide5 = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
  slide5.addText('Strategic fit', { x: 0.5, y: 0.2, w: 5.0, h: 0.5, fontSize: 24, bold: true, color: '0A192F' });

  // Scores
  const scores = [
    { label: 'Financial', val: initiative.financialScore || 0 },
    { label: 'Client', val: initiative.clientScore || 0 },
    { label: 'Internal', val: initiative.internalScore || 0 },
    { label: 'Learning/growth', val: initiative.learningScore || 0 }
  ];

  scores.forEach((s, i) => {
    const xPos = 0.5 + (i * 2.2);
    slide5.addText(`${s.val}`, { x: xPos, y: 0.8, w: 2.0, h: 0.6, fontSize: 28, bold: true, color: '0A192F', align: 'center' });
    slide5.addText(s.label, { x: xPos, y: 1.4, w: 2.0, h: 0.3, fontSize: 12, color: '0A192F', align: 'center' });
  });

  // Strategic Score Box
  slide5.addShape(pptx.ShapeType.rect, { x: 0.5, y: 2.4, w: 2.5, h: 1.2, fill: { color: 'BAE6FD' }, rectRadius: 0.1 });
  slide5.addText('Strategic score', { x: 0.7, y: 2.5, w: 2.1, h: 0.2, fontSize: 12, color: '0284C7' });
  slide5.addText(`${initiative.strategicScore || 0}`, { x: 0.7, y: 2.7, w: 2.1, h: 0.8, fontSize: 40, bold: true, color: '0A192F' });

  // Strategic Fit Overall Box
  slide5.addShape(pptx.ShapeType.rect, { x: 3.2, y: 2.4, w: 2.5, h: 1.2, fill: { color: 'F0F9FF' }, rectRadius: 0.1 });
  slide5.addText('Strategic fit overall', { x: 3.4, y: 2.5, w: 2.1, h: 0.2, fontSize: 12, color: '0284C7' });
  slide5.addText(`${initiative.strategicFitOverall || 0}%`, { x: 3.4, y: 2.7, w: 2.1, h: 0.8, fontSize: 40, bold: true, color: '0A192F' });

  // Slide 6: Economic analysis
  const slide6 = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
  slide6.addText('Economic analysis', { x: 0.5, y: 0.2, w: 6.0, h: 0.5, fontSize: 24, bold: true, color: '0A192F' });
  
  if (initiative.requiresCfoAnalysis) {
    slide6.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.8, w: 9.0, h: 4.5, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0' }, rectRadius: 0.1 });
    slide6.addText('CFO Analysis:', { x: 0.7, y: 1.0, w: 8.6, h: 0.4, fontSize: 16, bold: true, color: '0A192F' });
    slide6.addText(initiative.cfoAnalysis || 'Pending analysis...', {
      x: 0.7, y: 1.5, w: 8.6, h: 3.5, fontSize: 12, color: '0A192F', valign: 'top'
    });
    if (initiative.cfoReviewedAt) {
      slide6.addText(`Reviewed at: ${new Date(initiative.cfoReviewedAt).toLocaleDateString()}`, {
        x: 0.7, y: 5.0, w: 4.0, h: 0.3, fontSize: 10, color: '64748B'
      });
    }
  } else {
    slide6.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.8, w: 9.0, h: 1.5, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' }, rectRadius: 0.1 });
    slide6.addText('This section is required only when the total cost of the initiative exceeds 50 k€.', {
      x: 0.7, y: 1.0, w: 8.6, h: 1.0, fontSize: 14, color: '64748B', align: 'center'
    });
  }

  // Slide 7: Support Links
  if (initiative.supportLinks && initiative.supportLinks.length > 0) {
    const slide7 = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
    slide7.addText('Support Links', { x: 0.5, y: 0.2, w: 5.0, h: 0.5, fontSize: 24, bold: true, color: '0A192F' });
    
    initiative.supportLinks.forEach((link, idx) => {
      slide7.addText(link, {
        x: 0.7, y: 0.8 + (idx * 0.4), w: 8.6, h: 0.3,
        fontSize: 12, color: '3B82F6',
        hyperlink: { url: link, tooltip: link }
      });
    });
  }

  // Save the presentation
  await pptx.writeFile({ fileName: `Initiative_${initiative.title.replace(/[^a-z0-9]/gi, '_')}.pptx` });
};
