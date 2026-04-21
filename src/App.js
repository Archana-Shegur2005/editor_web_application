import './App.scss';
import { BrowserRouter, Route, Routes } from "react-router-dom";
import PaginatedEditor from './components/editor/PaginatedEditor';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PaginatedEditor />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
