import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDRNyBDXfCgb68wvvGVztCLJRLEmybtySE",
  authDomain: "tvup-seed-wizard.firebaseapp.com",
  projectId: "tvup-seed-wizard",
  storageBucket: "tvup-seed-wizard.firebasestorage.app",
  messagingSenderId: "343186445936",
  appId: "1:343186445936:web:7cef2215ce702e213146b5",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const getLevelValue = (level: string): number => {
  switch (level) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 1;
  }
};

const calculateScores = async () => {
  await signInAnonymously(auth);
  const usersSnapshot = await getDocs(collection(db, 'users'));
  const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const ideasSnapshot = await getDocs(collection(db, 'ideas'));
  const ideas = ideasSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const results = ideas.map(idea => {
    const votes = idea.votes || [];
    const author = users.find(u => u.id === idea.userId);
    const isAuthorProduct = author?.role?.toUpperCase() === 'ADMIN' || author?.role?.toUpperCase() === 'PRODUCT' || author?.role?.toUpperCase() === 'PRODUCT_TEAM';

    const validVotes = votes.filter((v: any) => {
      const voterRole = v.userRole || users.find(u => u.id === v.userId)?.role;
      return voterRole?.toUpperCase() === 'PRODUCT' || voterRole?.toUpperCase() === 'PRODUCT_TEAM' || voterRole?.toUpperCase() === 'ADMIN' || voterRole?.toUpperCase() === 'EDITOR';
    });

    const teamAssessments = validVotes.map((v: any) => ({
      businessImpact: v.businessImpact,
      engagement: v.engagement,
      traction: v.traction,
      virality: v.virality
    }));

    const authorHasVoted = validVotes.some((v: any) => v.userId === idea.userId);
    if (isAuthorProduct && !authorHasVoted) {
      teamAssessments.push({
        businessImpact: idea.data.businessImpact,
        engagement: idea.data.engagement,
        traction: idea.data.traction,
        virality: idea.data.virality
      });
    }

    if (teamAssessments.length === 0) {
      return { name: idea.data.seedName, current: 0, quadratic: 0, cubic: 0 };
    }

    const totalCurrent = teamAssessments.reduce((acc: number, assessment: any) => {
      const avgBiz = getLevelValue(assessment.businessImpact?.s1 || 'low') + getLevelValue(assessment.businessImpact?.s2 || 'low') + getLevelValue(assessment.businessImpact?.s3 || 'low');
      const avgEng = getLevelValue(assessment.engagement?.s1 || 'low') + getLevelValue(assessment.engagement?.s2 || 'low') + getLevelValue(assessment.engagement?.s3 || 'low');
      const avgTra = getLevelValue(assessment.traction?.s1 || 'low') + getLevelValue(assessment.traction?.s2 || 'low') + getLevelValue(assessment.traction?.s3 || 'low');
      const avgVir = getLevelValue(assessment.virality?.s1 || 'low') + getLevelValue(assessment.virality?.s2 || 'low') + getLevelValue(assessment.virality?.s3 || 'low');
      
      const weightedAvg = ((avgBiz/3) * 0.3 + (avgEng/3) * 0.3 + (avgTra/3) * 0.2 + (avgVir/3) * 0.2);
      return acc + weightedAvg;
    }, 0);

    const totalQuadratic = teamAssessments.reduce((acc: number, assessment: any) => {
      const avgBiz = getLevelValue(assessment.businessImpact?.s1 || 'low') + getLevelValue(assessment.businessImpact?.s2 || 'low') + getLevelValue(assessment.businessImpact?.s3 || 'low');
      const avgEng = getLevelValue(assessment.engagement?.s1 || 'low') + getLevelValue(assessment.engagement?.s2 || 'low') + getLevelValue(assessment.engagement?.s3 || 'low');
      const avgTra = getLevelValue(assessment.traction?.s1 || 'low') + getLevelValue(assessment.traction?.s2 || 'low') + getLevelValue(assessment.traction?.s3 || 'low');
      const avgVir = getLevelValue(assessment.virality?.s1 || 'low') + getLevelValue(assessment.virality?.s2 || 'low') + getLevelValue(assessment.virality?.s3 || 'low');
      
      const biz = avgBiz / 3;
      const eng = avgEng / 3;
      const tra = avgTra / 3;
      const vir = avgVir / 3;

      const quadratic = Math.sqrt(Math.pow(biz, 2) * 0.3 + Math.pow(eng, 2) * 0.3 + Math.pow(tra, 2) * 0.2 + Math.pow(vir, 2) * 0.2);
      return acc + quadratic;
    }, 0);

    const totalCubic = teamAssessments.reduce((acc: number, assessment: any) => {
      const avgBiz = getLevelValue(assessment.businessImpact?.s1 || 'low') + getLevelValue(assessment.businessImpact?.s2 || 'low') + getLevelValue(assessment.businessImpact?.s3 || 'low');
      const avgEng = getLevelValue(assessment.engagement?.s1 || 'low') + getLevelValue(assessment.engagement?.s2 || 'low') + getLevelValue(assessment.engagement?.s3 || 'low');
      const avgTra = getLevelValue(assessment.traction?.s1 || 'low') + getLevelValue(assessment.traction?.s2 || 'low') + getLevelValue(assessment.traction?.s3 || 'low');
      const avgVir = getLevelValue(assessment.virality?.s1 || 'low') + getLevelValue(assessment.virality?.s2 || 'low') + getLevelValue(assessment.virality?.s3 || 'low');
      
      const biz = avgBiz / 3;
      const eng = avgEng / 3;
      const tra = avgTra / 3;
      const vir = avgVir / 3;

      const cubic = Math.cbrt(Math.pow(biz, 3) * 0.3 + Math.pow(eng, 3) * 0.3 + Math.pow(tra, 3) * 0.2 + Math.pow(vir, 3) * 0.2);
      return acc + cubic;
    }, 0);

    const avgCurrent = totalCurrent / teamAssessments.length;
    const avgQuadratic = totalQuadratic / teamAssessments.length;
    const avgCubic = totalCubic / teamAssessments.length;

    const scaleTo10 = (val: number) => (val - 1) * 4.5 + 1;

    return {
      name: idea.data.seedName,
      current: scaleTo10(avgCurrent).toFixed(2),
      quadratic: scaleTo10(avgQuadratic).toFixed(2),
      cubic: scaleTo10(avgCubic).toFixed(2)
    };
  });

  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
};

calculateScores().catch(e => {
  console.error(e);
  process.exit(1);
});
