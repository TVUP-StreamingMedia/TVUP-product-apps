
import { Idea, Level, User, ImpactSection, IdeaVote } from '@/types';

export const getLevelValue = (level: Level): number => {
  switch (level) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 1;
  }
};

/**
 * Calculates the cubic mean (Norma 3) of a set of values.
 * Rewards high values and penalizes mediocrity.
 */
export const calculateCubicMean = (values: number[], weights?: number[]): number => {
  if (values.length === 0) return 0;
  
  if (weights && weights.length === values.length) {
    const sumCubes = values.reduce((acc, val, idx) => acc + weights[idx] * Math.pow(val, 3), 0);
    // If weights are normalized (sum to 1), we don't divide by length
    const weightSum = weights.reduce((a, b) => a + b, 0);
    return Math.cbrt(sumCubes / weightSum);
  }
  
  const sumCubes = values.reduce((acc, val) => acc + Math.pow(val, 3), 0);
  return Math.cbrt(sumCubes / values.length);
};

export const scaleTo10 = (val: number) => (val - 1) * 4.5 + 1;

/**
 * Calculates the score for a single assessment (vote or initial data)
 */
export const calculateSingleScore = (assessment: Partial<IdeaVote>, seedType: string): number => {
  const getSectionValue = (section?: ImpactSection): number => {
    if (!section) return 1;
    // Apply cubic mean to the 3 sub-questions to be consistent
    return calculateCubicMean([
      getLevelValue(section.s1),
      getLevelValue(section.s2),
      getLevelValue(section.s3)
    ]);
  };

  if (seedType === 'Business') {
    const rev = getSectionValue(assessment.revenuePotential);
    const dist = getSectionValue(assessment.distributionPower);
    const strat = getSectionValue(assessment.strategicPositioning);
    const mark = getSectionValue(assessment.marketValidation);
    
    // Weights: 35%, 30%, 25%, 10%
    const cubic = calculateCubicMean([rev, dist, strat, mark], [0.35, 0.30, 0.25, 0.10]);
    return Math.round(scaleTo10(cubic) * 10) / 10;
  }

  const biz = getSectionValue(assessment.businessImpact);
  const eng = getSectionValue(assessment.engagement);
  const tra = getSectionValue(assessment.traction);
  const vir = getSectionValue(assessment.virality);
  
  // Weights: 30%, 30%, 20%, 20%
  const cubic = calculateCubicMean([biz, eng, tra, vir], [0.3, 0.3, 0.2, 0.2]);
  return Math.round(scaleTo10(cubic) * 10) / 10;
};

export const getConsensusScore = (idea: Idea, users: User[]): number => {
  const votes = idea.votes || [];
  const author = users.find(u => u.id === idea.userId);
  const isAuthorProduct = author?.role?.toUpperCase() === 'ADMIN' || author?.role?.toUpperCase() === 'PRODUCT_TEAM';

  const teamAssessments: Partial<IdeaVote>[] = votes.filter(v => {
    if (v.userId === idea.userId) return false;
    const voterRole = v.userRole || users.find(u => u.id === v.userId)?.role;
    const roleUpper = voterRole?.toUpperCase();
    return roleUpper === 'PRODUCT_TEAM' || roleUpper === 'ADMIN' || roleUpper === 'EDITOR';
  });

  if (isAuthorProduct) {
    const ownerVote = votes.find(v => v.userId === idea.userId);
    if (ownerVote) {
      teamAssessments.push(ownerVote);
    } else {
      // Use initial data if no explicit vote
      teamAssessments.push({
        businessImpact: idea.data.businessImpact,
        engagement: idea.data.engagement,
        traction: idea.data.traction,
        virality: idea.data.virality,
        revenuePotential: idea.data.revenuePotential,
        distributionPower: idea.data.distributionPower,
        marketValidation: idea.data.marketValidation,
        strategicPositioning: idea.data.strategicPositioning
      });
    }
  }

  if (teamAssessments.length === 0) return 0;

  const scores = teamAssessments.map(a => calculateSingleScore(a, idea.data.seedType));
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  
  return Math.round(avgScore * 10) / 10;
};

export const getVoteCount = (idea: Idea, users: User[]): number => {
  const votes = idea.votes || [];
  const author = users.find(u => u.id === idea.userId);
  const isAuthorProduct = author?.role?.toUpperCase() === 'ADMIN' || author?.role?.toUpperCase() === 'PRODUCT_TEAM';
  
  const validVotes = votes.filter(v => {
    const voterRole = v.userRole || users.find(u => u.id === v.userId)?.role;
    const roleUpper = voterRole?.toUpperCase();
    return roleUpper === 'PRODUCT_TEAM' || roleUpper === 'ADMIN' || roleUpper === 'EDITOR';
  });
  
  const authorHasVoted = validVotes.some(v => v.userId === idea.userId);
  return validVotes.length + (isAuthorProduct && !authorHasVoted ? 1 : 0);
};

export const hasUserVoted = (idea: Idea, user: User | null): boolean => {
  if (!user) return false;
  const isAuthor = idea.userId === user.id;
  const roleUpper = user.role?.toUpperCase();
  const isProduct = roleUpper === 'ADMIN' || roleUpper === 'PRODUCT_TEAM' || roleUpper === 'EDITOR';
  const explicitlyVoted = (idea.votes || []).some(v => v.userId === user.id);
  
  // If they are product/admin and author, they are "voted" by default via initial assessment
  // Or if they have an explicit vote in the votes array
  return explicitlyVoted || (isAuthor && isProduct);
};
