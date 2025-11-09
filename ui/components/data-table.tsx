"use client"

import * as React from "react"
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  useReactTable,
  Column,
  Row,
} from "@tanstack/react-table"
import { ArrowUpDown, ArrowUp, ArrowDown, Filter, ChevronRight, ChevronDown } from "lucide-react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  getRowCanExpand?: (row: Row<TData>) => boolean
  renderSubComponent?: (row: Row<TData>) => React.ReactNode
}

export function DataTable<TData, TValue>({
  columns,
  data,
  getRowCanExpand,
  renderSubComponent,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [expanded, setExpanded] = React.useState<ExpandedState>({})

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: getRowCanExpand || (() => false),
    onSortingChange: setSorting,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnFiltersChange: setColumnFilters,
    onExpandedChange: setExpanded,
    state: {
      sorting,
      columnFilters,
      expanded,
    },
  })

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <React.Fragment key={row.id}>
                <TableRow
                  data-state={row.getIsSelected() && "selected"}
                  className={row.getIsExpanded() ? "bg-muted/50" : ""}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
                {row.getIsExpanded() && renderSubComponent && (
                  <TableRow>
                    <TableCell colSpan={row.getVisibleCells().length} className="p-0">
                      <div className="bg-muted/30 p-4">
                        {renderSubComponent(row)}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// Column header with dropdown for sorting and filtering
export function ColumnHeaderWithDropdown<TData, TValue>({
  column,
  title,
  filterType = "text",
}: {
  column: Column<TData, TValue>
  title: string
  filterType?: "text" | "number"
}) {
  const filterValue = column.getFilterValue() as string | undefined
  const isSorted = column.getIsSorted()
  const hasFilter = filterValue !== undefined && filterValue !== ""

  return (
    <div className="flex items-center gap-2">
      <span className="font-medium">{title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 data-[state=open]:bg-accent"
          >
            <div className="flex items-center gap-1">
              {(isSorted || hasFilter) && (
                <div className="flex items-center gap-0.5">
                  {isSorted === "asc" && <ArrowUp className="h-3 w-3 text-primary" />}
                  {isSorted === "desc" && <ArrowDown className="h-3 w-3 text-primary" />}
                  {hasFilter && <Filter className="h-3 w-3 text-primary" />}
                </div>
              )}
              {!isSorted && !hasFilter && <ArrowUpDown className="h-4 w-4 text-muted-foreground" />}
            </div>
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Sort & Filter</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {/* Sort Options */}
          <DropdownMenuItem
            onClick={() => column.toggleSorting(false)}
            className={isSorted === "asc" ? "bg-accent" : ""}
          >
            <ArrowUp className="mr-2 h-4 w-4" />
            Sort Ascending
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => column.toggleSorting(true)}
            className={isSorted === "desc" ? "bg-accent" : ""}
          >
            <ArrowDown className="mr-2 h-4 w-4" />
            Sort Descending
          </DropdownMenuItem>
          {isSorted && (
            <DropdownMenuItem onClick={() => column.clearSorting()}>
              Clear Sort
            </DropdownMenuItem>
          )}
          
          <DropdownMenuSeparator />
          
          {/* Filter Input */}
          <div className="px-2 py-1.5">
            <Input
              placeholder={`Filter ${title.toLowerCase()}...`}
              value={filterValue ?? ""}
              onChange={(event) => column.setFilterValue(event.target.value)}
              className="h-8"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              type={filterType}
            />
          </div>
          
          {hasFilter && (
            <DropdownMenuItem onClick={() => column.setFilterValue("")}>
              Clear Filter
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// Legacy component for backwards compatibility
export function SortableColumnHeader<TData, TValue>({
  column,
  title,
}: {
  column: Column<TData, TValue>
  title: string
}) {
  return <ColumnHeaderWithDropdown column={column} title={title} />
}
