import { useState, useCallback } from "react";
import './TableGridSelector.scss';

const MAX_ROWS = 8;
const MAX_COLS = 8;

const TableGridSelector = ({ onSelect }) => {
  const [hoveredRow, setHoveredRow] = useState(0);
  const [hoveredCol, setHoveredCol] = useState(0);

  const handleMouseEnter = useCallback((row, col) => {
    setHoveredRow(row);
    setHoveredCol(col);
  }, []);

  return (
    <div className="table-grid-selector">
      <div className="table-grid-selector__label">
        {hoveredRow > 0 ? `${hoveredRow} × ${hoveredCol}` : "Select size"}
      </div>
      <div
        className="table-grid-selector__grid"
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}
      >
        {Array.from({ length: MAX_ROWS * MAX_COLS }).map((_, i) => {
          const row = Math.floor(i / MAX_COLS) + 1;
          const col = (i % MAX_COLS) + 1;
          const isHighlighted = row <= hoveredRow && col <= hoveredCol;
          return (
            <div
              key={i}
              className={`table-grid-selector__cell${isHighlighted ? " table-grid-selector__cell--highlighted" : ""}`}
              onMouseEnter={() => handleMouseEnter(row, col)}
              onClick={() => onSelect(row, col)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default TableGridSelector;
