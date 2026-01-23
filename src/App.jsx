import './App.css';
import './home.css';
import { Routes, Route, Link } from 'react-router-dom';
import { lazy, Suspense } from 'react'
import {Header, Footer} from './Header';
import FuzzyText from './component/FuzzyText'
import ScrollToTop from './component/ScrollToTop';

const Home = lazy(() => import('./home.jsx'))
const Member = lazy(() => import('./member.jsx'))
const Posts = lazy(() => import('./posts.jsx'))
const Rocket = lazy(() => import('./rocket.jsx'))
const Admin = lazy(() => import('./admin.jsx'))

function App() {
  return (
    <div className="App">
      <Header />
      <ScrollToTop />
      <Routes>
        <Route path="/" element={
          <Suspense fallback={null}>
            <Home />
          </Suspense>
          } />
        <Route path='/rocket' element={
          <Suspense fallback={null}>
            <Rocket/>
          </Suspense>
        } />
        <Route path='/member' element={
          <Suspense fallback={null}>
            <Member/>
          </Suspense>
        } />
        <Route path='/posts' element={
          <Suspense fallback={null}>
            <Posts/>
          </Suspense>
        } />
        <Route path='/admin' element={
          <Suspense fallback={null}>
            <Admin/>
          </Suspense>
        } />
        <Route
          path="*"
          element={<Error/>}
        />
      </Routes>
      <Footer/>
      
    </div>
  );
}

function Error() {
  return(
    <div className="not-found">
              <div className="not-found__text">
                <FuzzyText fontSize="clamp(4rem, 16vw, 14rem)">404</FuzzyText>
                <FuzzyText fontSize="clamp(1.25rem, 6vw, 4rem)">page not found</FuzzyText>
              </div>
              <Link to="/" className="not-found__home">
                Back to home
              </Link>
            </div>
  )
}

export default App;
