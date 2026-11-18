// Package calculator implements the arithmetic behind the API. It knows nothing
// about HTTP so it can be tested and reused on its own.
package calculator

import (
	"errors"
	"math"
)

// Operation identifies a supported calculation.
type Operation string

const (
	Add        Operation = "add"
	Subtract   Operation = "subtract"
	Multiply   Operation = "multiply"
	Divide     Operation = "divide"
	Power      Operation = "power"
	Sqrt       Operation = "sqrt"
	Percentage Operation = "percentage"
)

var (
	ErrUnknownOperation = errors.New("unknown operation")
	ErrInvalidOperand   = errors.New("operands must be finite numbers")
	ErrDivisionByZero   = errors.New("division by zero")
	ErrNegativeSqrt     = errors.New("square root of a negative number")
	ErrUndefined        = errors.New("result is not a real number")
	ErrOverflow         = errors.New("result is out of range")
)

type operation struct {
	arity int
	apply func(a, b float64) (float64, error)
}

var operations = map[Operation]operation{
	Add:      {2, func(a, b float64) (float64, error) { return a + b, nil }},
	Subtract: {2, func(a, b float64) (float64, error) { return a - b, nil }},
	Multiply: {2, func(a, b float64) (float64, error) { return a * b, nil }},
	Divide: {2, func(a, b float64) (float64, error) {
		if b == 0 {
			return 0, ErrDivisionByZero
		}
		return a / b, nil
	}},
	Power: {2, func(a, b float64) (float64, error) {
		if a == 0 && b < 0 {
			return 0, ErrDivisionByZero
		}
		return math.Pow(a, b), nil
	}},
	Sqrt: {1, func(a, _ float64) (float64, error) {
		if a < 0 {
			return 0, ErrNegativeSqrt
		}
		return math.Sqrt(a), nil
	}},
	// Percentage returns a percent of b, so Percentage(15, 200) is 30.
	// Multiplying first keeps whole number cases exact (7% of 300 is 21, not
	// 21.000000000000004). Dividing first is the fallback when a*b overflows.
	Percentage: {2, func(a, b float64) (float64, error) {
		if p := a * b; !math.IsInf(p, 0) {
			return p / 100, nil
		}
		return a / 100 * b, nil
	}},
}

// Calculator applies the supported operations. It is stateless and safe for
// concurrent use.
type Calculator struct{}

// New returns a Calculator with all supported operations.
func New() Calculator { return Calculator{} }

// Arity reports how many operands op takes (1 or 2).
func (Calculator) Arity(op Operation) (int, error) {
	o, ok := operations[op]
	if !ok {
		return 0, ErrUnknownOperation
	}
	return o.arity, nil
}

// Calculate applies op to the operands. b is ignored for unary operations.
// The result is always a finite number; NaN and infinity are reported as errors.
func (Calculator) Calculate(op Operation, a, b float64) (float64, error) {
	o, ok := operations[op]
	if !ok {
		return 0, ErrUnknownOperation
	}
	// JSON cannot carry NaN or infinity, but Go callers can, and IEEE rules
	// would turn some of them into plausible results (1 ^ NaN is 1).
	if !isFinite(a) || (o.arity == 2 && !isFinite(b)) {
		return 0, ErrInvalidOperand
	}
	result, err := o.apply(a, b)
	if err != nil {
		return 0, err
	}
	switch {
	case math.IsNaN(result):
		return 0, ErrUndefined
	case math.IsInf(result, 0):
		return 0, ErrOverflow
	case result == 0:
		// Normalise negative zero so clients never see "-0".
		return 0, nil
	}
	return result, nil
}

func isFinite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }
