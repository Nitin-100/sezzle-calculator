package calculator

import (
	"errors"
	"math"
	"testing"
)

func TestCalculate(t *testing.T) {
	tests := []struct {
		name    string
		op      Operation
		a, b    float64
		want    float64
		wantErr error
	}{
		{"add", Add, 2, 3, 5, nil},
		{"add negatives", Add, -2.5, -0.5, -3, nil},
		{"subtract", Subtract, 10, 4, 6, nil},
		{"subtract to negative", Subtract, 4, 10, -6, nil},
		{"multiply", Multiply, 6, 7, 42, nil},
		{"multiply negative zero is normalised", Multiply, -1, 0, 0, nil},
		{"divide", Divide, 9, 2, 4.5, nil},
		{"divide by zero", Divide, 1, 0, 0, ErrDivisionByZero},
		{"divide zero by zero", Divide, 0, 0, 0, ErrDivisionByZero},
		{"power", Power, 2, 10, 1024, nil},
		{"power negative exponent", Power, 2, -1, 0.5, nil},
		{"power zero to negative", Power, 0, -1, 0, ErrDivisionByZero},
		{"power negative base fractional exponent", Power, -8, 0.5, 0, ErrUndefined},
		{"power overflow", Power, 10, 400, 0, ErrOverflow},
		{"sqrt", Sqrt, 16, 0, 4, nil},
		{"sqrt ignores b", Sqrt, 2.25, 99, 1.5, nil},
		{"sqrt negative", Sqrt, -4, 0, 0, ErrNegativeSqrt},
		{"percentage", Percentage, 15, 200, 30, nil},
		{"percentage stays exact for whole numbers", Percentage, 7, 300, 21, nil},
		{"percentage over 100", Percentage, 150, 40, 60, nil},
		{"percentage avoids intermediate overflow", Percentage, 1e308, 10, 1e307, nil},
		{"underflow rounds to zero", Divide, 1e-308, 1e308, 0, nil},
		{"zero to the power zero", Power, 0, 0, 1, nil},
		{"negative base whole exponent", Power, -8, 3, -512, nil},
		{"sqrt of negative zero is zero", Sqrt, math.Copysign(0, -1), 0, 0, nil},
		{"multiply overflow", Multiply, math.MaxFloat64, 2, 0, ErrOverflow},
		{"NaN operand", Power, 1, math.NaN(), 0, ErrInvalidOperand},
		{"infinite operand", Add, math.Inf(1), 1, 0, ErrInvalidOperand},
		{"NaN b is ignored for unary operations", Sqrt, 4, math.NaN(), 2, nil},
		{"unknown operation", Operation("modulo"), 1, 1, 0, ErrUnknownOperation},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New().Calculate(tt.op, tt.a, tt.b)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
			if got != tt.want || math.Signbit(got) != math.Signbit(tt.want) {
				t.Errorf("result = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestArity(t *testing.T) {
	for op, want := range map[Operation]int{
		Add: 2, Subtract: 2, Multiply: 2, Divide: 2, Power: 2, Percentage: 2, Sqrt: 1,
	} {
		got, err := New().Arity(op)
		if err != nil || got != want {
			t.Errorf("Arity(%q) = %d, %v; want %d, nil", op, got, err, want)
		}
	}

	if _, err := New().Arity("modulo"); !errors.Is(err, ErrUnknownOperation) {
		t.Errorf("Arity(unknown) error = %v, want %v", err, ErrUnknownOperation)
	}
}
